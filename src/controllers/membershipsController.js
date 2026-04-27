import { pool } from "../db/conn.js";
import ExcelJS from 'exceljs';

// Función helper para calcular el estado y días de mora basado en la fecha de expiración
const calculateStateAndArrears = async (expirationDate) => {
  const today = new Date();
  const expiration = new Date(expirationDate);
  
  // Calcular días hasta la expiración (puede ser negativo si ya expiró)
  const daysUntilExpiration = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));
  
  let stateNames;
  let daysArrears = 0;
  
  if (daysUntilExpiration > 5) {
    // Compatibilidad: algunas BD usan "Activo" en lugar de "Vigente".
    stateNames = ["Vigente", "Activo"];
  } else if (daysUntilExpiration >= 0) {
    // Entre 0 y 5 días hasta la expiración = Por vencer
    stateNames = ["Por vencer"];
  } else {
    // Ya expiró = Vencido
    stateNames = ["Vencido"];
    daysArrears = Math.abs(daysUntilExpiration);
  }
  
  // Obtener el ID del estado (aceptando nombres equivalentes)
  const stateResult = await pool.query(
    "SELECT id_state FROM states WHERE name_state = ANY($1) ORDER BY id_state ASC LIMIT 1",
    [stateNames]
  );
  
  if (stateResult.rows.length === 0) {
    throw new Error(`State '${stateNames.join("' or '")}' not found in database`);
  }
  
  return {
    id_state: stateResult.rows[0].id_state,
    days_arrears: daysArrears
  };
};

// Función interna para actualizar automáticamente estados y días de mora de todas las membresías
const updateAllMembershipStatesInternal = async () => {
  // Obtener todas las membresías
  const { rows: memberships } = await pool.query(`
    SELECT id_membership, expiration_date, days_arrears, id_state 
    FROM memberships
  `);

  let updatedCount = 0;
  
  for (const membership of memberships) {
    const { id_state: newStateId, days_arrears: newDaysArrears } = await calculateStateAndArrears(membership.expiration_date);
    
    // Solo actualizar si hay cambios
    if (newStateId !== membership.id_state || newDaysArrears !== membership.days_arrears) {
      await pool.query(
        "UPDATE memberships SET id_state = $1, days_arrears = $2 WHERE id_membership = $3",
        [newStateId, newDaysArrears, membership.id_membership]
      );
      updatedCount++;
    }
  }
  
  return { updatedCount };
};

// Función para actualizar automáticamente estados y días de mora de todas las membresías
export const updateAllMembershipStates = async (req, res) => {
  try {
    const result = await updateAllMembershipStatesInternal();
    return res.status(200).json({ 
      message: `Updated ${result.updatedCount} memberships`, 
      updatedCount: result.updatedCount 
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener todas las membresías con información relacionada (incluyendo manager)
export const getMemberships = async (req, res) => {
  try {
    // Primero actualizar automáticamente todos los estados y días de mora
    await updateAllMembershipStatesInternal();
    
    const { rows } = await pool.query(`
      SELECT m.id_membership,
        TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
        TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
        m.receipt_number, m.days_arrears, m.id_manager, m.id_user, m.id_plan, m.id_method, m.id_state,
        u.name_user, u.phone AS user_phone, 
        TO_CHAR(u.created_at, 'YYYY-MM-DD') as user_created_at,
        p.days_duration, p.price, 
        pm.name_method, 
        s.name_state,
        COALESCE(man.name_manager, m.manager_name_snapshot) as name_manager
      FROM memberships m
      JOIN users u ON m.id_user = u.id_user
      LEFT JOIN managers man ON m.id_manager = man.id_manager
      JOIN plans p ON m.id_plan = p.id_plan
      JOIN payment_methods pm ON m.id_method = pm.id_method
      JOIN states s ON m.id_state = s.id_state
      ORDER BY m.id_membership DESC
    `);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener una membresía por ID con información relacionada (incluyendo manager)
export const getMembershipById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid membership ID" });
    }
    
    // Primero actualizar el estado de esta membresía específica
    const membershipResult = await pool.query(
      "SELECT expiration_date, days_arrears, id_state FROM memberships WHERE id_membership = $1",
      [id]
    );
    
    if (membershipResult.rows.length === 0) {
      return res.status(404).json({ error: "Membership not found" });
    }
    
    const membership = membershipResult.rows[0];
    const { id_state: newStateId, days_arrears: newDaysArrears } = await calculateStateAndArrears(membership.expiration_date);
    
    // Actualizar si hay cambios
    if (newStateId !== membership.id_state || newDaysArrears !== membership.days_arrears) {
      await pool.query(
        "UPDATE memberships SET id_state = $1, days_arrears = $2 WHERE id_membership = $3",
        [newStateId, newDaysArrears, id]
      );
    }
    
    const { rows } = await pool.query(`
      SELECT m.id_membership,
        TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
        TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
        m.receipt_number, m.days_arrears, m.id_manager, m.id_user, m.id_plan, m.id_method, m.id_state,
        u.name_user, u.phone AS user_phone, 
        TO_CHAR(u.created_at, 'YYYY-MM-DD') as user_created_at,
        p.days_duration, p.price, 
        pm.name_method, 
        s.name_state,
        COALESCE(man.name_manager, m.manager_name_snapshot) as name_manager, 
        man.email AS manager_email
      FROM memberships m
      JOIN users u ON m.id_user = u.id_user
      LEFT JOIN managers man ON m.id_manager = man.id_manager
      JOIN plans p ON m.id_plan = p.id_plan
      JOIN payment_methods pm ON m.id_method = pm.id_method
      JOIN states s ON m.id_state = s.id_state
      WHERE m.id_membership = $1
    `, [id]);
    
    return res.status(200).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Crear una nueva membresía
export const createMembership = async (req, res) => {
  try {
    const memberships = req.body;
    const isBatch = Array.isArray(memberships);
    
    // Si es una sola membresía, convertirla en array para procesarla uniformemente
    const membershipsArray = isBatch ? memberships : [memberships];
    
    // Validar que no esté vacío
    if (membershipsArray.length === 0) {
      return res.status(400).json({ error: "Memberships data cannot be empty" });
    }

    // Validar límite de membresías por lote
    if (membershipsArray.length > 50) {
      return res.status(400).json({ error: "Cannot create more than 50 memberships at once" });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < membershipsArray.length; i++) {
      const { id_user, id_plan, id_method, receipt_number } = membershipsArray[i];

      try {
        // Validaciones básicas
        if (!id_user || !id_plan || !id_method || !receipt_number) {
          errors.push({ index: i, error: "id_user, id_plan, id_method y receipt_number son requeridos" });
          continue;
        }

        // Verificar que el usuario existe
        const userResult = await pool.query(
          "SELECT id_user FROM users WHERE id_user = $1",
          [id_user]
        );
        if (userResult.rows.length === 0) {
          errors.push({ index: i, error: "User not found" });
          continue;
        }

        // Verificar que el receipt_number no esté duplicado
        const receiptCheck = await pool.query(
          "SELECT id_membership FROM memberships WHERE receipt_number = $1",
          [receipt_number]
        );
        if (receiptCheck.rows.length > 0) {
          errors.push({ index: i, error: "Receipt number already exists" });
          continue;
        }

        // 1. Obtener los días de duración del plan
        const planResult = await pool.query(
          "SELECT days_duration FROM plans WHERE id_plan = $1",
          [id_plan]
        );
        if (planResult.rows.length === 0) {
          errors.push({ index: i, error: "Plan not found" });
          continue;
        }
        const daysDuration = planResult.rows[0].days_duration;

        // 3. Calcular la fecha de expiración
        let expirationDate = new Date();
        if (daysDuration === 1) {
          // Para plan de 1 día, la expiración es hoy
          // (last_payment es hoy por defecto)
        } else {
          expirationDate.setDate(expirationDate.getDate() + daysDuration - 1);
        }
        const expirationDateStr = expirationDate.toISOString().split('T')[0];

        // 4. Calcular el estado y días de mora automáticamente
        const { id_state, days_arrears: calculatedDaysArrears } = await calculateStateAndArrears(expirationDateStr);

        // 5. Insertar la nueva membresía
        const insertQuery = `
          INSERT INTO memberships (
            last_payment,
            expiration_date,
            receipt_number,
            days_arrears,
            id_user,
            id_plan,
            id_method,
            id_state,
            id_manager
          )
          VALUES (
            CURRENT_DATE,
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8
          )
          RETURNING id_membership, receipt_number
        `;

        const values = [
          expirationDateStr,
          receipt_number,
          calculatedDaysArrears,
          id_user,
          id_plan,
          id_method,
          id_state,
          req.manager.id_manager
        ];

        const { rows } = await pool.query(insertQuery, values);
        const newMembershipId = rows[0].id_membership;

        // 6. Obtener la membresía completa para la respuesta
        const membershipResult = await pool.query(`
          SELECT m.id_membership,
            TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
            TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
            m.receipt_number, m.days_arrears, m.id_manager, m.id_user, m.id_plan, m.id_method, m.id_state,
            u.name_user, u.phone AS user_phone, 
            TO_CHAR(u.created_at, 'YYYY-MM-DD') as user_created_at,
            p.days_duration, p.price, 
            pm.name_method, 
            s.name_state,
            COALESCE(man.name_manager, m.manager_name_snapshot) as name_manager
          FROM memberships m
          JOIN users u ON m.id_user = u.id_user
          JOIN plans p ON m.id_plan = p.id_plan
          JOIN payment_methods pm ON m.id_method = pm.id_method
          JOIN states s ON m.id_state = s.id_state
          LEFT JOIN managers man ON m.id_manager = man.id_manager
          WHERE m.id_membership = $1
        `, [newMembershipId]);

        results.push(membershipResult.rows[0]);
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    // Si es una sola membresía y no hay errores, devolver solo la membresía creada
    if (!isBatch && results.length === 1 && errors.length === 0) {
      return res.status(201).json(results[0]);
    }

    // Para lotes o cuando hay errores, devolver respuesta detallada
    const response = {
      created: results,
      errors: errors,
      summary: {
        total: membershipsArray.length,
        successful: results.length,
        failed: errors.length
      }
    };

    if (results.length > 0) {
      res.status(201).json(response);
    } else {
      res.status(400).json(response);
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Actualizar una membresía
export const updateMembership = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { last_payment, expiration_date, receipt_number, days_arrears, id_user, id_plan, id_method, id_state } = req.body;
    // Verificar que la membresía existe
    const membershipCheck = await pool.query(
      "SELECT id_membership FROM memberships WHERE id_membership = $1",
      [id]
    );
    if (membershipCheck.rows.length === 0) {
      return res.status(404).json({ error: "Membership not found" });
    }
    // Si se actualiza receipt_number, validar unicidad
    if (receipt_number) {
      const receiptCheck = await pool.query(
        "SELECT id_membership FROM memberships WHERE receipt_number = $1 AND id_membership != $2",
        [receipt_number, id]
      );
      if (receiptCheck.rows.length > 0) {
        return res.status(400).json({ error: "Receipt number already exists" });
      }
    }
    // Construir la consulta dinámicamente
    let updateFields = [];
    let values = [];
    let paramCount = 1;
    if (last_payment !== undefined) {
      updateFields.push(`last_payment = $${paramCount}`);
      values.push(last_payment);
      paramCount++;
    }
    if (expiration_date !== undefined) {
      updateFields.push(`expiration_date = $${paramCount}`);
      values.push(expiration_date);
      paramCount++;
    }
    if (receipt_number !== undefined) {
      updateFields.push(`receipt_number = $${paramCount}`);
      values.push(receipt_number);
      paramCount++;
    }
    if (days_arrears !== undefined) {
      updateFields.push(`days_arrears = $${paramCount}`);
      values.push(days_arrears);
      paramCount++;
    }
    if (id_user !== undefined) {
      updateFields.push(`id_user = $${paramCount}`);
      values.push(id_user);
      paramCount++;
    }
    if (id_plan !== undefined) {
      updateFields.push(`id_plan = $${paramCount}`);
      values.push(id_plan);
      paramCount++;
    }
    if (id_method !== undefined) {
      updateFields.push(`id_method = $${paramCount}`);
      values.push(id_method);
      paramCount++;
    }
    if (id_state !== undefined) {
      updateFields.push(`id_state = $${paramCount}`);
      values.push(id_state);
      paramCount++;
    }
    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE memberships SET ${updateFields.join(', ')} WHERE id_membership = $${paramCount} RETURNING id_membership, TO_CHAR(last_payment, 'YYYY-MM-DD') as last_payment, TO_CHAR(expiration_date, 'YYYY-MM-DD') as expiration_date, receipt_number, days_arrears, id_manager, id_user, id_plan, id_method, id_state`,
      values
    );
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Eliminar una membresía
export const deleteMembership = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rowCount } = await pool.query(
      "DELETE FROM memberships WHERE id_membership = $1",
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: "Membership not found" });
    }
    return res.sendStatus(204);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener solo las membresías activas (Vigente y Por vencer)
export const getActiveMemberships = async (req, res) => {
  try {
    // Primero actualizar automáticamente todos los estados y días de mora
    await updateAllMembershipStatesInternal();
    
    const { rows } = await pool.query(`
      SELECT m.id_membership,
        TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
        TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
        m.receipt_number, m.days_arrears, m.id_manager, m.id_user, m.id_plan, m.id_method, m.id_state,
        u.name_user, u.phone AS user_phone, 
        TO_CHAR(u.created_at, 'YYYY-MM-DD') as user_created_at,
        p.days_duration, p.price, 
        pm.name_method, 
        s.name_state,
        COALESCE(man.name_manager, m.manager_name_snapshot) as name_manager
      FROM memberships m
      JOIN users u ON m.id_user = u.id_user
      LEFT JOIN managers man ON m.id_manager = man.id_manager
      JOIN plans p ON m.id_plan = p.id_plan
      JOIN payment_methods pm ON m.id_method = pm.id_method
      JOIN states s ON m.id_state = s.id_state
      WHERE s.name_state IN ('Vigente', 'Activo', 'Por vencer')
      ORDER BY m.id_membership DESC
    `);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}; 

// Exportar membresías a Excel
export const exportMembershipsToExcel = async (req, res) => {
  try {
    // Obtener los filtros de la query
    const { searchTerm, selectedState, selectedPlan } = req.query;
    
    // Primero actualizar automáticamente todos los estados y días de mora
    await updateAllMembershipStatesInternal();
    
    // Construir la consulta base
    let query = `
      SELECT m.id_membership,
        TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
        TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
        m.receipt_number, m.days_arrears, m.id_manager, m.id_user, m.id_plan, m.id_method, m.id_state,
        u.name_user, u.phone AS user_phone, 
        TO_CHAR(u.created_at, 'YYYY-MM-DD') as user_created_at,
        p.days_duration, p.price, 
        pm.name_method, 
        s.name_state,
        COALESCE(man.name_manager, m.manager_name_snapshot) as name_manager
      FROM memberships m
      JOIN users u ON m.id_user = u.id_user
      LEFT JOIN managers man ON m.id_manager = man.id_manager
      JOIN plans p ON m.id_plan = p.id_plan
      JOIN payment_methods pm ON m.id_method = pm.id_method
      JOIN states s ON m.id_state = s.id_state
    `;
    
    const conditions = [];
    const params = [];
    let paramCount = 1;
    
    // Aplicar filtros si se proporcionan
    if (searchTerm && searchTerm.trim() !== '') {
      conditions.push(`(LOWER(u.name_user) LIKE LOWER($${paramCount}) OR LOWER(u.phone) LIKE LOWER($${paramCount}))`);
      params.push(`%${searchTerm.trim()}%`);
      paramCount++;
    }
    
    if (selectedState && selectedState !== 'todos') {
      conditions.push(`s.name_state = $${paramCount}`);
      params.push(selectedState);
      paramCount++;
    }
    
    if (selectedPlan && selectedPlan !== 'todos') {
      conditions.push(`p.days_duration = $${paramCount}`);
      params.push(parseInt(selectedPlan));
      paramCount++;
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY m.id_membership DESC`;
    
    // Ejecutar la consulta
    const { rows } = await pool.query(query, params);
    
    // Crear el archivo Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Membresías');
    
    // Definir los headers
    const headers = [
      'No.',
      'Nombre',
      'Teléfono',
      'Fecha inscripción',
      'Último pago',
      'Método de pago',
      'Administrador',
      'No. recibo',
      'Plan',
      'Vence',
      'Estado',
      'Días en mora'
    ];
    
    // Añadir headers
    worksheet.addRow(headers);
    
    // Aplicar negrilla a los headers
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    
    // Añadir datos
    rows.forEach((row, index) => {
      worksheet.addRow([
        index + 1, 
        row.name_user,
        row.user_phone,
        row.user_created_at,
        row.last_payment,
        row.name_method,
        row.name_manager,
        row.receipt_number,
        `${row.days_duration} ${row.days_duration === 1 ? 'día' : 'días'}`,
        row.expiration_date,
        row.name_state,
        row.days_arrears > 0 ? row.days_arrears : ''
      ]);
    });
    
    // Aplicar filtro solo en los headers
    worksheet.autoFilter = {
      from: 'A1',
      to: `L1`
    };

    worksheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, cell => {
        const cellValue = cell.value ? cell.value.toString() : '';
        maxLength = Math.max(maxLength, cellValue.length);
      });
      column.width = maxLength + 2; // +2 para un poco de espacio extra
    });
    
    // Configurar headers de respuesta
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="membresias.xlsx"');
    res.setHeader('Cache-Control', 'no-cache');
    
    // Escribir el archivo a la respuesta
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    return res.status(500).json({ error: 'Error al exportar a Excel' });
  }
}; 

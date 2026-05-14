import { pool } from "../db/conn.js";
import { isPhone10Digits, isValidPersonDisplayName } from "../utils/personNamePhone.js";

// Función helper para obtener la membresía activa de un usuario
const getActiveMembership = async (userId) => {
  const result = await pool.query(`
    SELECT m.id_membership,
      TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
      TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
      m.receipt_number,
      m.days_arrears,
      p.days_duration,
      p.price,
      pm.name_method,
      s.name_state
    FROM memberships m
    JOIN plans p ON m.id_plan = p.id_plan
    JOIN payment_methods pm ON m.id_method = pm.id_method
    JOIN states s ON m.id_state = s.id_state
    WHERE m.id_user = $1 AND s.name_state IN ('Vigente', 'Por vencer')
    ORDER BY m.id_membership DESC
    LIMIT 1
  `, [userId]);
  
  return result.rows[0] || null;
};

// Obtener todos los usuarios
export const getUsers = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id_user, name_user, phone, 
        TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
      FROM users
      ORDER BY id_user DESC
    `);
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener un usuario por ID
export const getUserById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    
    const { rows } = await pool.query(`
      SELECT id_user, name_user, phone, 
        TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
      FROM users 
      WHERE id_user = $1
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const createUser = async (req, res) => {
  try {
    const users = req.body;
    const isBatch = Array.isArray(users);
    
    // Si es un solo usuario, convertirlo en array para procesarlo uniformemente
    const usersArray = isBatch ? users : [users];
    
    // Validar que no esté vacío
    if (usersArray.length === 0) {
      return res.status(400).json({ error: "Users data cannot be empty" });
    }

    // Validar límite de usuarios por lote
    if (usersArray.length > 100) {
      return res.status(400).json({ error: "Cannot create more than 100 users at once" });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < usersArray.length; i++) {
      const { name_user, phone } = usersArray[i];

      try {
        const trimmedName = String(name_user ?? "").trim();
        // Validar campos requeridos
        if (!trimmedName || !phone) {
          errors.push({ index: i, error: "name_user and phone are required" });
          continue;
        }

        if (!isValidPersonDisplayName(trimmedName)) {
          errors.push({
            index: i,
            error:
              "El nombre solo puede contener letras y espacios (sin números ni caracteres especiales)",
          });
          continue;
        }

        // Validar que el teléfono tenga exactamente 10 dígitos
        if (!isPhone10Digits(phone)) {
          errors.push({ index: i, error: "El teléfono debe tener exactamente 10 dígitos" });
          continue;
        }

        // Verificar que el teléfono no esté duplicado
        const phoneCheck = await pool.query(
          "SELECT id_user FROM users WHERE phone = $1",
          [phone]
        );

        if (phoneCheck.rows.length > 0) {
          errors.push({ index: i, error: "Phone number already exists" });
          continue;
        }

        // Insertar usuario
        const { rows } = await pool.query(
          "INSERT INTO users (name_user, phone) VALUES ($1, $2) RETURNING *",
          [trimmedName, phone]
        );

        results.push(rows[0]);
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    // Si es un solo usuario y no hay errores, devolver solo el usuario creado
    if (!isBatch && results.length === 1 && errors.length === 0) {
      return res.status(201).json(results[0]);
    }

    // Para lotes o cuando hay errores, devolver respuesta detallada
    const response = {
      created: results,
      errors: errors,
      summary: {
        total: usersArray.length,
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

export const updateUser = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name_user, phone } = req.body;

    // Verificar que el usuario existe
    const userCheck = await pool.query(
      "SELECT id_user FROM users WHERE id_user = $1",
      [id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Si se está actualizando el teléfono, validar que tenga exactamente 10 dígitos
    if (phone !== undefined && !isPhone10Digits(phone)) {
      return res.status(400).json({ error: "El teléfono debe tener exactamente 10 dígitos" });
    }

    if (name_user !== undefined) {
      const trimmedName = String(name_user).trim();
      if (!trimmedName) {
        return res.status(400).json({ error: "name_user cannot be empty" });
      }
      if (!isValidPersonDisplayName(trimmedName)) {
        return res.status(400).json({
          error:
            "El nombre solo puede contener letras y espacios (sin números ni caracteres especiales)",
        });
      }
    }

    // Si se está actualizando el teléfono, verificar que no esté duplicado
    if (phone) {
      const phoneCheck = await pool.query(
        "SELECT id_user FROM users WHERE phone = $1 AND id_user != $2",
        [phone, id]
      );

      if (phoneCheck.rows.length > 0) {
        return res.status(400).json({ error: "Phone number already exists" });
      }
    }

    let updateFields = [];
    let values = [];
    let paramCount = 1;

    if (name_user !== undefined) {
      updateFields.push(`name_user = $${paramCount}`);
      values.push(String(name_user).trim());
      paramCount++;
    }

    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }

    values.push(id);

    const { rows } = await pool.query(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id_user = $${paramCount} RETURNING id_user, name_user, phone, TO_CHAR(created_at, 'YYYY-MM-DD') as created_at`,
      values
    );

    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // Verificar que el usuario existe
    const userCheck = await pool.query(
      "SELECT id_user FROM users WHERE id_user = $1",
      [id]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Iniciar transacción para eliminar membresías primero y luego el usuario
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Eliminar todas las membresías del usuario
      await client.query(
        "DELETE FROM memberships WHERE id_user = $1",
        [id]
      );

      // 2. Eliminar el usuario
      const { rowCount } = await client.query(
        "DELETE FROM users WHERE id_user = $1",
        [id]
      );

      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: "User not found" });
      }

      await client.query('COMMIT');
      return res.sendStatus(204);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Crear usuario con membresía en una sola transacción
export const createUserWithMembership = async (req, res) => {
  try {
    const { 
      name_user, 
      phone, 
      id_plan, 
      id_method, 
      id_manager,
      receipt_number
    } = req.body;

    // Validaciones
    if (!name_user || !phone || !id_plan || !id_method || !id_manager || !receipt_number) {
      return res.status(400).json({ 
        error: "name_user, phone, id_plan, id_method, id_manager y receipt_number son requeridos" 
      });
    }

    const trimmedName = String(name_user).trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }
    if (!isValidPersonDisplayName(trimmedName)) {
      return res.status(400).json({
        error:
          "El nombre solo puede contener letras y espacios (sin números ni caracteres especiales)",
      });
    }
    if (!isPhone10Digits(phone)) {
      return res.status(400).json({ error: "El teléfono debe tener exactamente 10 dígitos" });
    }

    // Verificar que el teléfono no exista
    const existingUser = await pool.query(
      "SELECT id_user FROM users WHERE phone = $1",
      [phone]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Phone number already exists" });
    }

    // Verificar que el receipt_number no esté duplicado
    const receiptCheck = await pool.query(
      "SELECT id_membership FROM memberships WHERE receipt_number = $1",
      [receipt_number]
    );
    if (receiptCheck.rows.length > 0) {
      return res.status(400).json({ error: "Receipt number already exists" });
    }

    // Verificar que el plan existe
    const planResult = await pool.query(
      "SELECT days_duration FROM plans WHERE id_plan = $1",
      [id_plan]
    );
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: "Plan not found" });
    }
    const daysDuration = planResult.rows[0].days_duration;

    // Verificar que el método de pago existe
    const methodResult = await pool.query(
      "SELECT id_method FROM payment_methods WHERE id_method = $1",
      [id_method]
    );
    if (methodResult.rows.length === 0) {
      return res.status(404).json({ error: "Payment method not found" });
    }

    // Verificar que el manager existe
    const managerResult = await pool.query(
      "SELECT id_manager FROM managers WHERE id_manager = $1",
      [id_manager]
    );
    if (managerResult.rows.length === 0) {
      return res.status(404).json({ error: "Manager not found" });
    }

    // Iniciar transacción
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const now = new Date();
      // 1. Crear el usuario con fecha de inscripción automática del sistema
      const userResult = await client.query(`
        INSERT INTO users (name_user, phone, created_at)
        VALUES ($1, $2, $3)
        RETURNING id_user
      `, [
        trimmedName,
        phone,
        now
      ]);
      
      const userId = userResult.rows[0].id_user;

      // 2. Verificar nuevamente que el receipt_number no esté duplicado (dentro de la transacción)
      const receiptCheckInTransaction = await client.query(
        "SELECT id_membership FROM memberships WHERE receipt_number = $1",
        [receipt_number]
      );
      if (receiptCheckInTransaction.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "Receipt number already exists" });
      }

      // 3. Calcular fecha de expiración basada en fecha actual del sistema
      const expirationDate = new Date(now);
      expirationDate.setDate(expirationDate.getDate() + daysDuration - 1);
      const expirationDateStr = expirationDate.toISOString().split('T')[0];

      // 4. Calcular estado y días de mora
      const today = new Date();
      const expiration = new Date(expirationDateStr);
      const daysUntilExpiration = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));
      
      let stateName;
      let daysArrears = 0;
      
      if (daysUntilExpiration > 5) {
        stateName = "Vigente";
      } else if (daysUntilExpiration >= 0) {
        stateName = "Por vencer";
      } else {
        stateName = "Vencido";
        daysArrears = Math.abs(daysUntilExpiration);
      }
      
      const stateResult = await client.query(
        "SELECT id_state FROM states WHERE name_state = $1",
        [stateName]
      );
      
      if (stateResult.rows.length === 0) {
        throw new Error(`State '${stateName}' not found in database`);
      }
      
      const id_state = stateResult.rows[0].id_state;

      // 5. Crear la membresía con fecha de último pago automática del sistema
      const membershipResult = await client.query(`
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
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9
        )
        RETURNING id_membership, receipt_number
      `, [
        now,
        expirationDateStr,
        receipt_number,
        daysArrears,
        userId,
        id_plan,
        id_method,
        id_state,
        req.manager.id_manager
      ]);
      
      const membershipId = membershipResult.rows[0].id_membership;

      // 6. Obtener datos completos para la respuesta
      const finalResult = await client.query(`
        SELECT 
          u.id_user,
          u.name_user,
          u.phone,
          TO_CHAR(u.created_at, 'YYYY-MM-DD') as registration_date,
          m.id_membership,
          TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
          TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
          m.receipt_number,
          m.days_arrears,
          p.days_duration,
          p.price,
          pm.name_method,
          s.name_state,
          man.name_manager
        FROM users u
        JOIN memberships m ON u.id_user = m.id_user
        JOIN plans p ON m.id_plan = p.id_plan
        JOIN payment_methods pm ON m.id_method = pm.id_method
        JOIN states s ON m.id_state = s.id_state
        JOIN managers man ON m.id_manager = man.id_manager
        WHERE u.id_user = $1 AND m.id_membership = $2
      `, [userId, membershipId]);

      await client.query('COMMIT');
      
      res.status(201).json(finalResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener todas las membresías de un usuario específico
export const getUserMemberships = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // Verificar que el usuario existe
    const userCheck = await pool.query(
      "SELECT id_user FROM users WHERE id_user = $1",
      [id]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const { rows } = await pool.query(`
      SELECT m.id_membership,
        TO_CHAR(m.last_payment, 'YYYY-MM-DD') as last_payment,
        TO_CHAR(m.expiration_date, 'YYYY-MM-DD') as expiration_date,
        m.receipt_number,
        m.days_arrears,
        p.days_duration,
        p.price,
        pm.name_method,
        s.name_state,
        COALESCE(man.name_manager, m.manager_name_snapshot) as name_manager
      FROM memberships m
      JOIN plans p ON m.id_plan = p.id_plan
      JOIN payment_methods pm ON m.id_method = pm.id_method
      JOIN states s ON m.id_state = s.id_state
      LEFT JOIN managers man ON m.id_manager = man.id_manager
      WHERE m.id_user = $1
      ORDER BY m.id_membership DESC
    `, [id]);

    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener todos los usuarios con información de membresía activa
export const getUsersWithActiveMemberships = async (req, res) => {
  try {
    const { rows: users } = await pool.query(`
      SELECT id_user, name_user, phone, 
        TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
      FROM users
      ORDER BY id_user DESC
    `);

    // Agregar información de membresía activa a cada usuario
    const usersWithMemberships = await Promise.all(
      users.map(async (user) => {
        const activeMembership = await getActiveMembership(user.id_user);
        return {
          ...user,
          active_membership: activeMembership
        };
      })
    );

    return res.status(200).json(usersWithMemberships);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Obtener un usuario por ID con información de membresía activa
export const getUserByIdWithActiveMembership = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }
    
    const { rows } = await pool.query(`
      SELECT id_user, name_user, phone, 
        TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
      FROM users 
      WHERE id_user = $1
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = rows[0];
    const activeMembership = await getActiveMembership(id);

    return res.status(200).json({
      ...user,
      active_membership: activeMembership
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Actualizar usuario con membresía en una sola transacción
export const updateUserWithMembership = async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { 
      name_user, 
      phone, 
      id_plan, 
      id_method, 
      id_manager,
      receipt_number
    } = req.body;

    // Validaciones
    if (!name_user || !phone || !id_plan || !id_method || !receipt_number) {
      return res.status(400).json({ 
        error: "name_user, phone, id_plan, id_method y receipt_number son requeridos" 
      });
    }

    const trimmedName = String(name_user).trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "El nombre es requerido" });
    }
    if (!isValidPersonDisplayName(trimmedName)) {
      return res.status(400).json({
        error:
          "El nombre solo puede contener letras y espacios (sin números ni caracteres especiales)",
      });
    }
    if (!isPhone10Digits(phone)) {
      return res.status(400).json({ error: "El teléfono debe tener exactamente 10 dígitos" });
    }

    // Verificar que el usuario existe
    const userCheck = await pool.query(
      "SELECT id_user FROM users WHERE id_user = $1",
      [userId]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verificar que el teléfono no esté duplicado (excluyendo el usuario actual)
    const phoneCheck = await pool.query(
      "SELECT id_user FROM users WHERE phone = $1 AND id_user != $2",
      [phone, userId]
    );
    if (phoneCheck.rows.length > 0) {
      return res.status(400).json({ error: "Phone number already exists" });
    }

    // Verificar que el receipt_number no esté duplicado (excluyendo la membresía actual del usuario)
    const receiptCheck = await pool.query(`
      SELECT m.id_membership 
      FROM memberships m 
      WHERE m.receipt_number = $1 
      AND m.id_user != $2
    `, [receipt_number, userId]);
    if (receiptCheck.rows.length > 0) {
      return res.status(400).json({ error: "Receipt number already exists" });
    }

    // Verificar que el plan existe
    const planResult = await pool.query(
      "SELECT days_duration FROM plans WHERE id_plan = $1",
      [id_plan]
    );
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: "Plan not found" });
    }
    const daysDuration = planResult.rows[0].days_duration;

    // Verificar que el método de pago existe
    const methodResult = await pool.query(
      "SELECT id_method FROM payment_methods WHERE id_method = $1",
      [id_method]
    );
    if (methodResult.rows.length === 0) {
      return res.status(404).json({ error: "Payment method not found" });
    }

    // Obtener el manager actual si no se proporciona uno nuevo
    let finalManagerId = req.manager.id_manager;
    if (!id_manager) {
      const currentMembership = await pool.query(`
        SELECT id_manager FROM memberships 
        WHERE id_user = $1 
        ORDER BY id_membership DESC 
        LIMIT 1
      `, [userId]);
      if (currentMembership.rows.length === 0 || !currentMembership.rows[0].id_manager) {
        // Si no hay membresía previa o el id_manager es null, usa el admin logueado
        finalManagerId = req.manager.id_manager;
      } else {
        finalManagerId = currentMembership.rows[0].id_manager;
      }
    } else {
      // Verificar que el manager existe si se proporciona uno nuevo
      const managerResult = await pool.query(
        "SELECT id_manager FROM managers WHERE id_manager = $1",
        [id_manager]
      );
      if (managerResult.rows.length === 0) {
        return res.status(404).json({ error: "Manager not found" });
      }
      finalManagerId = id_manager;
    }

    // Iniciar transacción
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Actualizar el usuario (sin modificar fecha de inscripción)
      await client.query(`
        UPDATE users 
        SET name_user = $1, phone = $2
        WHERE id_user = $3
      `, [trimmedName, phone, userId]);

      // 2. Obtener la membresía activa/más reciente
      const currentMembership = await client.query(`
        SELECT id_membership, id_state
        FROM memberships 
        WHERE id_user = $1 
        ORDER BY id_membership DESC 
        LIMIT 1
      `, [userId]);

      if (currentMembership.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "No membership found for user" });
      }

      // 3. Actualizar la membresía existente
      const membershipId = currentMembership.rows[0].id_membership;

      const now = new Date();
      // Calcular nueva fecha de expiración basada en fecha actual del sistema
      const expirationDate = new Date(now);
      expirationDate.setDate(expirationDate.getDate() + daysDuration - 1);
      const expirationDateStr = expirationDate.toISOString().split('T')[0];

      // Calcular estado y días de mora
      const today = new Date();
      const expiration = new Date(expirationDateStr);
      const daysUntilExpiration = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));
      
      let stateName;
      let daysArrears = 0;
      
      if (daysUntilExpiration > 5) {
        stateName = "Vigente";
      } else if (daysUntilExpiration >= 0) {
        stateName = "Por vencer";
      } else {
        stateName = "Vencido";
        daysArrears = Math.abs(daysUntilExpiration);
      }
      
      const stateResult = await client.query(
        "SELECT id_state FROM states WHERE name_state = $1",
        [stateName]
      );
      
      if (stateResult.rows.length === 0) {
        throw new Error(`State '${stateName}' not found in database`);
      }
      
      const id_state = stateResult.rows[0].id_state;

      // Actualizar la membresía con fecha de último pago automática del sistema
      await client.query(`
        UPDATE memberships 
        SET last_payment = $1,
            expiration_date = $2,
            receipt_number = $3,
            days_arrears = $4,
            id_plan = $5,
            id_method = $6,
            id_state = $7,
            id_manager = $8
        WHERE id_membership = $9
      `, [
        now,
        expirationDateStr,
        receipt_number,
        daysArrears,
        id_plan,
        id_method,
        id_state,
        finalManagerId,
        membershipId
      ]);

      await client.query('COMMIT');
      
      // Obtener datos actualizados del usuario
      const updatedUserResult = await client.query(`
        SELECT id_user, name_user, phone, 
          TO_CHAR(created_at, 'YYYY-MM-DD') as created_at
        FROM users 
        WHERE id_user = $1
      `, [userId]);
      
      res.status(200).json({
        message: "User updated successfully",
        user: updatedUserResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
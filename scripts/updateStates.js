import { pool } from "./src/db/conn.js";

// Función para calcular el estado y días de mora
const calculateStateAndArrears = async (expirationDate) => {
  const today = new Date();
  const expiration = new Date(expirationDate);
  
  const daysUntilExpiration = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));
  
  let stateNames;
  let daysArrears = 0;
  
  if (daysUntilExpiration > 5) {
    // Compatibilidad: algunas BD usan "Activo" en lugar de "Vigente".
    stateNames = ["Vigente", "Activo"];
  } else if (daysUntilExpiration >= 0) {
    stateNames = ["Por vencer"];
  } else {
    stateNames = ["Vencido"];
    daysArrears = Math.abs(daysUntilExpiration);
  }
  
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

// Función principal para actualizar todos los estados
const updateAllMembershipStates = async () => {
  try {
    console.log(`[${new Date().toISOString()}] Iniciando actualización de estados...`);
    
    const { rows: memberships } = await pool.query(`
      SELECT id_membership, expiration_date, days_arrears, id_state 
      FROM memberships
    `);

    let updatedCount = 0;
    
    for (const membership of memberships) {
      const { id_state: newStateId, days_arrears: newDaysArrears } = await calculateStateAndArrears(membership.expiration_date);
      
      if (newStateId !== membership.id_state || newDaysArrears !== membership.days_arrears) {
        await pool.query(
          "UPDATE memberships SET id_state = $1, days_arrears = $2 WHERE id_membership = $3",
          [newStateId, newDaysArrears, membership.id_membership]
        );
        updatedCount++;
      }
    }

    console.log(`[${new Date().toISOString()}] Actualización completada. ${updatedCount} membresías actualizadas.`);
    
    // Cerrar la conexión
    await pool.end();
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error:`, error.message);
    await pool.end();
    process.exit(1);
  }
};

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  updateAllMembershipStates();
}

export { updateAllMembershipStates }; 
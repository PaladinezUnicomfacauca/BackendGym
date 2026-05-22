import { pool } from "../db/conn.js";

const NAME_MAX_LEN = 30;

export const getIdentificationTypes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM identification_types ORDER BY id_identification_type ASC"
    );
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const getIdentificationTypeById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid identification type ID" });
    }
    const { rows } = await pool.query(
      "SELECT * FROM identification_types WHERE id_identification_type = $1",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Identification type not found" });
    }
    return res.status(200).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const createIdentificationType = async (req, res) => {
  try {
    const items = req.body;
    const isBatch = Array.isArray(items);
    const itemsArray = isBatch ? items : [items];

    if (itemsArray.length === 0) {
      return res.status(400).json({ error: "Identification types data cannot be empty" });
    }

    if (itemsArray.length > 50) {
      return res.status(400).json({
        error: "Cannot create more than 50 identification types at once",
      });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < itemsArray.length; i++) {
      const { name_identification_type } = itemsArray[i];

      try {
        if (!name_identification_type || String(name_identification_type).trim() === "") {
          errors.push({ index: i, error: "Identification type name is required" });
          continue;
        }

        const trimmed = String(name_identification_type).trim();
        if (trimmed.length > NAME_MAX_LEN) {
          errors.push({
            index: i,
            error: `Identification type name must be at most ${NAME_MAX_LEN} characters`,
          });
          continue;
        }

        const nameCheck = await pool.query(
          "SELECT id_identification_type FROM identification_types WHERE name_identification_type = $1",
          [trimmed]
        );

        if (nameCheck.rows.length > 0) {
          errors.push({
            index: i,
            error: "An identification type with this name already exists",
          });
          continue;
        }

        const { rows } = await pool.query(
          "INSERT INTO identification_types (name_identification_type) VALUES ($1) RETURNING *",
          [trimmed]
        );

        results.push(rows[0]);
      } catch (error) {
        errors.push({ index: i, error: error.message });
      }
    }

    if (!isBatch && results.length === 1 && errors.length === 0) {
      return res.status(201).json(results[0]);
    }

    const response = {
      created: results,
      errors,
      summary: {
        total: itemsArray.length,
        successful: results.length,
        failed: errors.length,
      },
    };

    if (results.length > 0) {
      return res.status(201).json(response);
    }
    return res.status(400).json(response);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateIdentificationType = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid identification type ID" });
    }

    const { name_identification_type } = req.body;
    if (!name_identification_type || String(name_identification_type).trim() === "") {
      return res.status(400).json({ error: "Identification type name is required" });
    }

    const trimmed = String(name_identification_type).trim();
    if (trimmed.length > NAME_MAX_LEN) {
      return res.status(400).json({
        error: `Identification type name must be at most ${NAME_MAX_LEN} characters`,
      });
    }

    const typeCheck = await pool.query(
      "SELECT id_identification_type FROM identification_types WHERE id_identification_type = $1",
      [id]
    );
    if (typeCheck.rows.length === 0) {
      return res.status(404).json({ error: "Identification type not found" });
    }

    const nameCheck = await pool.query(
      `SELECT id_identification_type FROM identification_types
       WHERE name_identification_type = $1 AND id_identification_type != $2`,
      [trimmed, id]
    );
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({
        error: "An identification type with this name already exists",
      });
    }

    const { rows } = await pool.query(
      `UPDATE identification_types SET name_identification_type = $1
       WHERE id_identification_type = $2 RETURNING *`,
      [trimmed, id]
    );
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteIdentificationType = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid identification type ID" });
    }

    const usersCheck = await pool.query(
      "SELECT id_user FROM users WHERE identification_type = $1",
      [id]
    );
    if (usersCheck.rows.length > 0) {
      return res.status(400).json({
        error:
          "No se puede eliminar el tipo de identificación. Hay usuarios que lo usan. Reasígnalos primero.",
      });
    }

    const { rowCount } = await pool.query(
      "DELETE FROM identification_types WHERE id_identification_type = $1",
      [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ message: "Identification type not found" });
    }
    return res.sendStatus(204);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

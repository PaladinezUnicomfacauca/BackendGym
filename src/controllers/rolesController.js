import { pool } from "../db/conn.js";

const NAME_MAX_LEN = 20;

export const getRoles = async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM roles ORDER BY id_role ASC");
    return res.status(200).json(rows);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const getRoleById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }
    const { rows } = await pool.query(
      "SELECT * FROM roles WHERE id_role = $1",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }
    return res.status(200).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const createRole = async (req, res) => {
  try {
    const roles = req.body;
    const isBatch = Array.isArray(roles);
    const rolesArray = isBatch ? roles : [roles];

    if (rolesArray.length === 0) {
      return res.status(400).json({ error: "Roles data cannot be empty" });
    }

    if (rolesArray.length > 50) {
      return res.status(400).json({ error: "Cannot create more than 50 roles at once" });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < rolesArray.length; i++) {
      const { name_role } = rolesArray[i];

      try {
        if (!name_role || String(name_role).trim() === "") {
          errors.push({ index: i, error: "Role name is required" });
          continue;
        }

        const trimmed = String(name_role).trim();
        if (trimmed.length > NAME_MAX_LEN) {
          errors.push({
            index: i,
            error: `Role name must be at most ${NAME_MAX_LEN} characters`
          });
          continue;
        }

        const nameCheck = await pool.query(
          "SELECT id_role FROM roles WHERE name_role = $1",
          [trimmed]
        );

        if (nameCheck.rows.length > 0) {
          errors.push({ index: i, error: "A role with this name already exists" });
          continue;
        }

        const { rows } = await pool.query(
          "INSERT INTO roles (name_role) VALUES ($1) RETURNING *",
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
        total: rolesArray.length,
        successful: results.length,
        failed: errors.length
      }
    };

    if (results.length > 0) {
      return res.status(201).json(response);
    }
    return res.status(400).json(response);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateRole = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const { name_role } = req.body;
    if (!name_role || String(name_role).trim() === "") {
      return res.status(400).json({ error: "Role name is required" });
    }

    const trimmed = String(name_role).trim();
    if (trimmed.length > NAME_MAX_LEN) {
      return res.status(400).json({
        error: `Role name must be at most ${NAME_MAX_LEN} characters`
      });
    }

    const roleCheck = await pool.query(
      "SELECT id_role FROM roles WHERE id_role = $1",
      [id]
    );
    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    const nameCheck = await pool.query(
      "SELECT id_role FROM roles WHERE name_role = $1 AND id_role != $2",
      [trimmed, id]
    );
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ error: "A role with this name already exists" });
    }

    const { rows } = await pool.query(
      "UPDATE roles SET name_role = $1 WHERE id_role = $2 RETURNING *",
      [trimmed, id]
    );
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteRole = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const managersCheck = await pool.query(
      "SELECT id_manager FROM managers WHERE id_role = $1",
      [id]
    );
    if (managersCheck.rows.length > 0) {
      return res.status(400).json({
        error:
          "Cannot delete role. There are managers assigned to this role. Reassign them first."
      });
    }

    const { rowCount } = await pool.query("DELETE FROM roles WHERE id_role = $1", [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: "Role not found" });
    }
    return res.sendStatus(204);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

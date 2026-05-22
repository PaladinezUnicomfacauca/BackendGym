import express from "express";
import {
  getIdentificationTypes,
  getIdentificationTypeById,
  createIdentificationType,
  updateIdentificationType,
  deleteIdentificationType,
} from "../controllers/identificationTypesController.js";

const router = express.Router();

router.get("/", getIdentificationTypes);
router.get("/:id", getIdentificationTypeById);
router.post("/", createIdentificationType);
router.put("/:id", updateIdentificationType);
router.delete("/:id", deleteIdentificationType);

export default router;

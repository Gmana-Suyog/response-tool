const express = require("express");
const router = express.Router();
const Category = require("../models/Category");

// GET /api/categories - Get all categories (optionally filtered by type)
router.get("/", async (req, res) => {
  try {
    const { type } = req.query;
    const filter = type ? { type } : {};
    const categories = await Category.find(filter).sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/categories - Create a new category
router.post("/", async (req, res) => {
  try {
    const { name, type } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Category name is required" });
    }

    if (!type || !type.trim()) {
      return res.status(400).json({ error: "Category type is required" });
    }

    const category = new Category({ name: name.trim(), type: type.trim() });
    await category.save();

    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error
      return res
        .status(409)
        .json({ error: "Category already exists for this type" });
    }
    console.error("Error creating category:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/categories/:id - Delete a category
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    // Check if category is in use by any scenarios of the same type
    const Scenario = require("../models/Scenario");
    const scenariosUsingCategory = await Scenario.countDocuments({
      category: category.name,
      type: category.type,
    });

    if (scenariosUsingCategory > 0) {
      return res.status(409).json({
        error: `Cannot delete category "${category.name}". It is used by ${scenariosUsingCategory} ${category.type} scenario(s).`,
        inUse: true,
        usageCount: scenariosUsingCategory,
      });
    }

    await Category.findByIdAndDelete(id);
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Helper: check if user is project admin
const isProjectAdmin = (project, userId) => {
  if (project.owner.toString() === userId.toString()) return true;
  const member = project.members.find(m => m.user.toString() === userId.toString());
  return member && member.role === 'admin';
};

// Helper: check if user is project member
const isProjectMember = (project, userId) => {
  return project.members.some(m => m.user.toString() === userId.toString());
};

// @GET /api/projects - Get all projects for current user
router.get('/', protect, async (req, res) => {
  try {
    const projects = await Project.find({
      'members.user': req.user._id
    }).populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar')
      .sort({ createdAt: -1 });

    // Add task counts
    const projectsWithCounts = await Promise.all(projects.map(async (p) => {
      const taskCounts = await Task.aggregate([
        { $match: { project: p._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      const counts = { todo: 0, 'in-progress': 0, review: 0, done: 0 };
      taskCounts.forEach(t => { counts[t._id] = t.count; });
      return { ...p.toObject(), taskCounts: counts };
    }));

    res.json({ success: true, projects: projectsWithCounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/projects - Create project
router.post('/', protect, [
  body('name').trim().isLength({ min: 3 }).withMessage('Project name must be at least 3 characters'),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }
    const { name, description, status, priority, color, dueDate, tags } = req.body;
    const project = await Project.create({
      name, description, status, priority, color, dueDate, tags,
      owner: req.user._id
    });
    await project.populate('owner', 'name email avatar');
    await project.populate('members.user', 'name email avatar');
    res.status(201).json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/projects/:id - Get single project
router.get('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'name email avatar')
      .populate('members.user', 'name email avatar');
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isProjectMember(project, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const taskCounts = await Task.aggregate([
      { $match: { project: project._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const counts = { todo: 0, 'in-progress': 0, review: 0, done: 0 };
    taskCounts.forEach(t => { counts[t._id] = t.count; });
    res.json({ success: true, project: { ...project.toObject(), taskCounts: counts } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/projects/:id - Update project
router.put('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isProjectAdmin(project, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only project admins can update' });
    }
    const { name, description, status, priority, color, dueDate, tags } = req.body;
    const updated = await Project.findByIdAndUpdate(
      req.params.id,
      { name, description, status, priority, color, dueDate, tags },
      { new: true, runValidators: true }
    ).populate('owner', 'name email avatar')
     .populate('members.user', 'name email avatar');
    res.json({ success: true, project: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/projects/:id - Delete project
router.delete('/:id', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only project owner can delete' });
    }
    await Task.deleteMany({ project: req.params.id });
    await Project.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/projects/:id/members - Add member
router.post('/:id/members', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isProjectAdmin(project, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only admins can add members' });
    }
    const { userId, role } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const alreadyMember = project.members.some(m => m.user.toString() === userId);
    if (alreadyMember) {
      return res.status(400).json({ success: false, message: 'User is already a member' });
    }
    project.members.push({ user: userId, role: role || 'member' });
    await project.save();
    await project.populate('members.user', 'name email avatar');
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/projects/:id/members/:userId - Remove member
router.delete('/:id/members/:userId', protect, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isProjectAdmin(project, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only admins can remove members' });
    }
    if (project.owner.toString() === req.params.userId) {
      return res.status(400).json({ success: false, message: 'Cannot remove project owner' });
    }
    project.members = project.members.filter(m => m.user.toString() !== req.params.userId);
    await project.save();
    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

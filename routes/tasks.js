const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

const isProjectMember = (project, userId) =>
  project.members.some(m => m.user.toString() === userId.toString());

const isProjectAdmin = (project, userId) => {
  if (project.owner.toString() === userId.toString()) return true;
  const member = project.members.find(m => m.user.toString() === userId.toString());
  return member && member.role === 'admin';
};

// @GET /api/tasks - Get tasks (with filters)
router.get('/', protect, async (req, res) => {
  try {
    const { project, status, priority, assignee, overdue, search } = req.query;
    const filter = {};

    if (project) filter.project = project;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignee) filter.assignee = assignee;
    if (search) filter.title = { $regex: search, $options: 'i' };
    if (overdue === 'true') {
      filter.dueDate = { $lt: new Date() };
      filter.status = { $ne: 'done' };
    }

    // If no project filter, only show tasks from projects user is member of
    if (!project) {
      const userProjects = await Project.find({ 'members.user': req.user._id }, '_id');
      filter.project = { $in: userProjects.map(p => p._id) };
    } else {
      const proj = await Project.findById(project);
      if (!proj || !isProjectMember(proj, req.user._id)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    const tasks = await Task.find(filter)
      .populate('assignee', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('project', 'name color')
      .sort({ order: 1, createdAt: -1 });

    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/tasks - Create task
router.post('/', protect, [
  body('title').trim().isLength({ min: 3 }).withMessage('Task title must be at least 3 characters'),
  body('project').notEmpty().withMessage('Project is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }
    const { title, description, status, priority, project, assignee, dueDate, tags } = req.body;
    const proj = await Project.findById(project);
    if (!proj) return res.status(404).json({ success: false, message: 'Project not found' });
    if (!isProjectMember(proj, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const task = await Task.create({
      title, description, status, priority, project, assignee: assignee || null,
      dueDate, tags, createdBy: req.user._id
    });
    await task.populate('assignee', 'name email avatar');
    await task.populate('createdBy', 'name email avatar');
    await task.populate('project', 'name color');
    res.status(201).json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @GET /api/tasks/:id - Get single task
router.get('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignee', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('project', 'name color members owner')
      .populate('comments.user', 'name email avatar');
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const proj = await Project.findById(task.project._id);
    if (!isProjectMember(proj, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @PUT /api/tasks/:id - Update task
router.put('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const proj = await Project.findById(task.project);
    if (!isProjectMember(proj, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const { title, description, status, priority, assignee, dueDate, tags } = req.body;
    Object.assign(task, {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
      ...(priority !== undefined && { priority }),
      ...(assignee !== undefined && { assignee: assignee || null }),
      ...(dueDate !== undefined && { dueDate }),
      ...(tags !== undefined && { tags })
    });
    await task.save();
    await task.populate('assignee', 'name email avatar');
    await task.populate('createdBy', 'name email avatar');
    await task.populate('project', 'name color');
    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/tasks/:id - Delete task
router.delete('/:id', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const proj = await Project.findById(task.project);
    if (!isProjectMember(proj, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    // Only task creator or project admin can delete
    const canDelete = task.createdBy.toString() === req.user._id.toString() || isProjectAdmin(proj, req.user._id);
    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this task' });
    }
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/tasks/:id/comments - Add comment
router.post('/:id/comments', protect, [
  body('text').trim().isLength({ min: 1 }).withMessage('Comment cannot be empty')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const proj = await Project.findById(task.project);
    if (!isProjectMember(proj, req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    task.comments.push({ user: req.user._id, text: req.body.text });
    await task.save();
    await task.populate('comments.user', 'name email avatar');
    res.json({ success: true, comments: task.comments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @DELETE /api/tasks/:id/comments/:commentId - Delete comment
router.delete('/:id/comments/:commentId', protect, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const comment = task.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
    if (comment.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    comment.deleteOne();
    await task.save();
    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

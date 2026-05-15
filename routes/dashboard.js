const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

// @GET /api/dashboard - Get dashboard stats
router.get('/', protect, async (req, res) => {
  try {
    // Get all projects user is member of
    const userProjects = await Project.find({ 'members.user': req.user._id }, '_id name color status');
    const projectIds = userProjects.map(p => p._id);

    // Task stats
    const taskStats = await Task.aggregate([
      { $match: { project: { $in: projectIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const taskCounts = { todo: 0, 'in-progress': 0, review: 0, done: 0 };
    taskStats.forEach(t => { taskCounts[t._id] = t.count; });

    // Overdue tasks
    const overdueCount = await Task.countDocuments({
      project: { $in: projectIds },
      dueDate: { $lt: new Date() },
      status: { $ne: 'done' }
    });

    // My tasks
    const myTaskStats = await Task.aggregate([
      { $match: { project: { $in: projectIds }, assignee: req.user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const myTaskCounts = { todo: 0, 'in-progress': 0, review: 0, done: 0 };
    myTaskStats.forEach(t => { myTaskCounts[t._id] = t.count; });

    // Recent tasks
    const recentTasks = await Task.find({ project: { $in: projectIds } })
      .populate('assignee', 'name avatar')
      .populate('project', 'name color')
      .sort({ updatedAt: -1 })
      .limit(8);

    // Overdue tasks list
    const overdueTasks = await Task.find({
      project: { $in: projectIds },
      dueDate: { $lt: new Date() },
      status: { $ne: 'done' }
    }).populate('assignee', 'name avatar')
      .populate('project', 'name color')
      .sort({ dueDate: 1 })
      .limit(5);

    // Priority breakdown
    const priorityStats = await Task.aggregate([
      { $match: { project: { $in: projectIds }, status: { $ne: 'done' } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    // Project stats
    const projectStats = await Promise.all(userProjects.slice(0, 6).map(async (proj) => {
      const total = await Task.countDocuments({ project: proj._id });
      const done = await Task.countDocuments({ project: proj._id, status: 'done' });
      return {
        _id: proj._id,
        name: proj.name,
        color: proj.color,
        status: proj.status,
        total,
        done,
        progress: total > 0 ? Math.round((done / total) * 100) : 0
      };
    }));

    res.json({
      success: true,
      stats: {
        projects: { total: userProjects.length, active: userProjects.filter(p => p.status === 'active').length },
        tasks: { ...taskCounts, total: Object.values(taskCounts).reduce((a, b) => a + b, 0), overdue: overdueCount },
        myTasks: { ...myTaskCounts, total: Object.values(myTaskCounts).reduce((a, b) => a + b, 0) },
        recentTasks,
        overdueTasks,
        priorityStats,
        projectStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

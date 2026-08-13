const settingsRepo = require('../repositories/settings.repository');

async function getSettings(req, res, next) {
  try {
    const settings = await settingsRepo.getSettings();
    res.status(200).json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    const updated = await settingsRepo.updateSettings(req.body);
    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  updateSettings
};

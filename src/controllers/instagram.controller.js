const instagramService = require('../services/instagram.service');

async function getTokenStatus(req, res, next) {
  try {
    const status = await instagramService.validateToken();
    res.status(200).json(status);
  } catch (err) {
    next(err);
  }
}

async function debugSend(req, res, next) {
  try {
    const result = await instagramService.debugSend();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTokenStatus,
  debugSend
};

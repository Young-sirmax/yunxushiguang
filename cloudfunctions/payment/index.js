const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return {
    code: -1,
    msg: '平台已改为完全免费，所有功能免费开放，不收取任何费用'
  };
};
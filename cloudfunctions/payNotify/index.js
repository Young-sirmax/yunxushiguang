const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return {
    return_code: 'SUCCESS',
    return_msg: '平台已改为完全免费'
  };
};
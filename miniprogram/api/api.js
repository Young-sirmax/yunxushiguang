const db = wx.cloud.database();
const _ = db.command;

const callCloudFunction = async (name, data = {}) => {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    const result = res && res.result !== undefined ? res.result : res;

    if (result && typeof result === 'object' && result.code !== undefined && result.code !== 0) {
      const error = new Error(result.msg || '云函数 ' + name + ' 执行失败');
      error.code = result.code;
      error.detail = result;
      throw error;
    }

    return result;
  } catch (err) {
    if (err instanceof Error && err.code !== undefined) {
      throw err;
    }
    const message = err && err.errMsg ? err.errMsg : (err && err.message ? err.message : '请求失败');
    const normalizedError = err instanceof Error ? err : new Error(message);
    normalizedError.name = 'CloudFunctionError';
    console.error('云函数 ' + name + ' 调用失败:', err);
    throw normalizedError;
  }
};

const API = {
  login: () => callCloudFunction('user', { action: 'login' }),
  updateUser: (data) => callCloudFunction('user', { action: 'update', data }),
  getUserInfo: (openid) => callCloudFunction('user', { action: 'getInfo', openid }),

  getUniversityList: () => callCloudFunction('university', { action: 'list' }),

  getCategoryList: () => callCloudFunction('category', { action: 'list' }),

  getCommodityList: (params) => callCloudFunction('commodity', Object.assign({ action: 'list' }, params)),
  getCommodityDetail: (id) => callCloudFunction('commodity', { action: 'detail', id }),
  createCommodity: (data) => callCloudFunction('commodity', { action: 'create', data }),
  updateCommodity: (id, data) => callCloudFunction('commodity', { action: 'update', id, data }),
  deleteCommodity: (id) => callCloudFunction('commodity', { action: 'delete', id }),
  restoreCommodity: (id) => callCloudFunction('commodity', { action: 'restore', id }),
  searchCommodity: (keyword, categoryId) => callCloudFunction('commodity', { action: 'search', keyword, categoryId }),

  sendSubscribeMsg: (data) => callCloudFunction('subscribeMsg', Object.assign({ action: 'send' }, data)),

  createFeedback: (data) => callCloudFunction('feedback', { action: 'create', data }),
  getFeedbackList: (params) => callCloudFunction('feedback', Object.assign({ action: 'list' }, params)),
  getFeedbackDetail: (id) => callCloudFunction('feedback', { action: 'detail', id }),
  updateFeedback: (id, data) => callCloudFunction('feedback', { action: 'update', id, data }),
  deleteFeedback: (id) => callCloudFunction('feedback', { action: 'delete', id }),
  urgeFeedback: (id) => callCloudFunction('feedback', { action: 'urge', id }),

  toggleFavorite: (commodityId) => callCloudFunction('favorite', { action: 'toggle', commodityId }),
  checkFavorite: (commodityId) => callCloudFunction('favorite', { action: 'check', commodityId }),
  getFavoriteList: (params) => callCloudFunction('favorite', Object.assign({ action: 'list' }, params)),
  removeFavorite: (id) => callCloudFunction('favorite', { action: 'remove', id }),

  chatCreateConversation: (data) => callCloudFunction('chat', { action: 'createConversation', data }),
  chatGetConversationList: () => callCloudFunction('chat', { action: 'getConversationList' }),
  chatGetConversationDetail: (id) => callCloudFunction('chat', { action: 'getConversationDetail', id }),
  chatSendMessage: (data) => callCloudFunction('chat', { action: 'sendMessage', data }),
  chatMarkAsRead: (id) => callCloudFunction('chat', { action: 'markAsRead', id }),
  chatDeleteConversation: (id) => callCloudFunction('chat', { action: 'deleteConversation', id })
};

module.exports = API;
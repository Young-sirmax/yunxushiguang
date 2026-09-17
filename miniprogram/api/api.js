const callCloudFunction = async (name, data = {}) => {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    const result = res && res.result !== undefined ? res.result : res;

    if (result && typeof result === 'object' && result.code !== undefined && result.code !== 0) {
      const error = new Error(result.msg || '服务暂时不可用，请稍后重试');
      error.code = result.code;
      error.detail = result;
      throw error;
    }

    return result;
  } catch (err) {
    if (err instanceof Error && err.code !== undefined) {
      throw err;
    }
    const rawMsg = (err && err.errMsg) || (err && err.message) || '';
    let message = '网络请求失败，请稍后重试';
    if (rawMsg.indexOf('-504002') > -1) {
      message = '云函数服务异常，请稍后重试';
    } else if (rawMsg.indexOf('-504003') > -1) {
      message = '云函数环境错误，请检查云开发环境配置';
    } else if (rawMsg) {
      message = rawMsg.replace(/^.*Error:\s*/, '').trim() || '请求失败';
    }
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
  verifyStudent: (data) => callCloudFunction('user', { action: 'verifyStudent', data }),
  cancelVerifyStudent: () => callCloudFunction('user', { action: 'cancelVerifyStudent' }),

  // 技能达人入驻
  expertApply: (data) => callCloudFunction('user', { action: 'expertApply', data }),
  expertWithdraw: () => callCloudFunction('user', { action: 'expertWithdraw' }),
  expertAudit: (userId, result, reason) => callCloudFunction('user', { action: 'expertAudit', userId, result, reason }),

  // 技能服务评价
  createReview: (data) => callCloudFunction('review', Object.assign({ action: 'create' }, data)),
  getReviewsByTarget: (params) => callCloudFunction('review', Object.assign({ action: 'listByTarget' }, params)),
  getMyReceivedReviews: (params) => callCloudFunction('review', Object.assign({ action: 'myReceived' }, params)),
  checkReviewed: (postId) => callCloudFunction('review', { action: 'checkByPost', postId }),

  // 全局配置（维护模式开关）
  getAppConfig: () => callCloudFunction('config', { action: 'get' }),
  // 联系方式复制限流（轻量防刷）
  checkContactAccess: () => callCloudFunction('commodity', { action: 'checkContactAccess' }),

  adminLogin: (password) => callCloudFunction('admin', { action: 'login', password }),
  adminCheck: () => callCloudFunction('admin', { action: 'checkAdmin' }),
  adminLogout: () => callCloudFunction('admin', { action: 'logout' }),
  adminListVerify: (status) => callCloudFunction('admin', { action: 'listVerify', status }),
  adminAuditVerify: (id, result, reason) => callCloudFunction('admin', { action: 'auditVerify', id, result, reason }),

  // 管理员 · 批量上架（需 config.admin_openids 白名单）
  batchUnzipImages: (zipFileID) => callCloudFunction('adminBatch', { action: 'unzipImages', zipFileID }),
  batchImportRows: (rows, batchId) => callCloudFunction('adminBatch', { action: 'importRows', rows, batchId }),
  batchListDrafts: (params) => callCloudFunction('adminBatch', Object.assign({ action: 'listDrafts' }, params)),
  batchPublishDraft: (id) => callCloudFunction('adminBatch', { action: 'publishDraft', id }),
  batchDeleteDraft: (id) => callCloudFunction('adminBatch', { action: 'deleteDraft', id }),

  // 管理员 · 数据管理（用户）
  adminListUsers: (params) => callCloudFunction('admin', Object.assign({ action: 'listUsers' }, params)),
  adminSetAdmin: (userId, isAdmin) => callCloudFunction('admin', { action: 'setAdmin', userId, isAdmin }),
  adminSetBan: (userId, banned) => callCloudFunction('admin', { action: 'setBan', userId, banned }),
  adminDeleteUser: (userId) => callCloudFunction('admin', { action: 'deleteUser', userId }),

  // 管理员 · 数据管理（商品/求购）
  adminListCommodity: (params) => callCloudFunction('commodity', Object.assign({ action: 'adminList' }, params)),
  adminSetCommodityStatus: (id, status, reason) => callCloudFunction('commodity', { action: 'adminSetStatus', id, status, reason }),
  adminDeleteCommodity: (id) => callCloudFunction('commodity', { action: 'adminDelete', id }),

  getUniversityList: () => callCloudFunction('university', { action: 'list' }),

  getCategoryList: () => callCloudFunction('category', { action: 'list' }),

  getCommodityList: (params) => callCloudFunction('commodity', Object.assign({ action: 'list' }, params)),
  getCommodityDetail: (id) => callCloudFunction('commodity', { action: 'detail', id }),
  // 图片临时链接失效/加载失败时，按 fileID 重新解析（命中云端缓存则不重新签发）
  resolveImages: (fileIDs) => callCloudFunction('commodity', { action: 'resolveImages', fileIDs }),
  createCommodity: (data) => callCloudFunction('commodity', { action: 'create', data }),
  updateCommodity: (id, data) => callCloudFunction('commodity', { action: 'update', id, data }),
  deleteCommodity: (id) => callCloudFunction('commodity', { action: 'delete', id }),
  restoreCommodity: (id) => callCloudFunction('commodity', { action: 'restore', id }),
  setTradeStatus: (id, tradeStatus) => callCloudFunction('commodity', { action: 'setTradeStatus', id, tradeStatus }),
  searchCommodity: (keyword, categoryId) => callCloudFunction('commodity', { action: 'search', keyword, categoryId }),
  getPendingCommodityList: (page, pageSize) => callCloudFunction('commodity', { action: 'pendingList', page, pageSize }),
  approveCommodity: (id) => callCloudFunction('commodity', { action: 'approve', id }),
  rejectCommodity: (id, reason) => callCloudFunction('commodity', { action: 'reject', id, reason }),

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
  removeFavorite: (id) => callCloudFunction('favorite', { action: 'remove', commodityId })
};

module.exports = API;
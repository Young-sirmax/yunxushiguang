// pages/batch_invite/batch_invite.js —— 接受批量上架邀请卡（指令 4.2 方式 A）
//
// 由超管在「批量上架 → 授权」生成邀请卡后转发而来，路径携带一次性 token。
// 受邀人点「接受」即完成绑定，全程不需要输入任何东西。
// 注意：本页不要求受邀人先在小程序内登录过 —— openid 由云函数侧 getWXContext 取，
//      授权动作本身不依赖客户端登录态。

const app = getApp();
const API = require('../../api/api.js');
const { showToast } = require('../../utils/util.js');

Page({
  data: {
    token: '',
    accepting: false,
    done: false,
    errMsg: ''
  },

  onLoad(options) {
    const token = (options && options.token) ? String(options.token) : '';
    this.setData({ token });
    if (!token) {
      this.setData({ errMsg: '邀请卡链接不完整，请让管理员重新生成' });
    }
  },

  async accept() {
    if (this.data.accepting || this.data.done) return;
    if (!this.data.token) {
      showToast('邀请卡无效');
      return;
    }

    this.setData({ accepting: true, errMsg: '' });
    try {
      const res = await API.batchAcceptInvite(this.data.token);
      // 权限变更后主动作废本地配置缓存，入口立刻可见（指令 4.3）
      app.clearAppConfigCache();
      this.setData({ accepting: false, done: true });
      wx.showModal({
        title: '授权成功',
        content: '你已成为批量上架专员。回到「我的」页即可看到「批量上架」入口。',
        showCancel: false,
        confirmText: '去看看',
        success: () => {
          wx.reLaunch({ url: '/pages/home/home' });
        }
      });
      // res.msg 可能是「你已拥有批量上架权限」，同样按成功处理
      if (res && res.msg) console.log('acceptInvite:', res.msg);
    } catch (err) {
      this.setData({ accepting: false, errMsg: err.message || '接受邀请失败' });
      showToast(err.message || '接受邀请失败');
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});

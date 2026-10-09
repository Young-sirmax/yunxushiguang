// pages/home_feedback/home_feedback.js —— 意见反馈（加入「云叙石光」反馈群）
const { showToast } = require('../../utils/util.js');

Page({
  data: {
    qrPath: '/images/feedback-qr.png',
    // 群二维码有过期风险，兜底方案：直接加运营者微信拉人进群
    wechatId: 'Young15301160075'
  },

  onShareAppMessage() {
    return {
      title: '云叙石光 · 意见反馈｜扫码加入反馈交流群',
      path: '/pages/home_feedback/home_feedback'
    };
  },

  // 复制微信号（整行与「复制」按钮共用，catchtap 已阻断冒泡，不会重复触发）
  copyWechat() {
    const wechatId = this.data.wechatId;
    wx.setClipboardData({
      data: wechatId,
      success: () => showToast('微信号已复制，去微信搜索添加'),
      fail: () => showToast(`复制失败，请手动输入：${wechatId}`)
    });
  },

  // 点击二维码查看大图
  previewQr() {
    wx.previewImage({ urls: [this.data.qrPath] });
  },

  // 保存二维码到相册
  saveQr() {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting['scope.writePhotosAlbum'] === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许“保存到相册”后重试；也可以长按二维码直接保存。',
            confirmText: '去设置',
            success: (m) => {
              if (m.confirm) wx.openSetting();
            }
          });
          return;
        }
        wx.getImageInfo({
          src: this.data.qrPath,
          success: (info) => {
            wx.saveImageToPhotosAlbum({
              filePath: info.path,
              success: () => showToast('已保存到相册'),
              fail: () => showToast('保存失败，可长按二维码保存')
            });
          },
          fail: () => showToast('保存失败，可长按二维码保存')
        });
      }
    });
  }
});

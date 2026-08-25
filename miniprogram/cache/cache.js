const CACHE_PREFIX = 'campus_trade_';

const cache = {
  set(key, value, expire = 0) {
    const data = {
      value,
      time: Date.now(),
      expire: expire > 0 ? expire * 1000 : 0
    };
    wx.setStorageSync(CACHE_PREFIX + key, data);
  },
  get(key) {
    const data = wx.getStorageSync(CACHE_PREFIX + key);
    if (!data) return null;
    if (data.expire > 0 && Date.now() - data.time > data.expire) {
      this.remove(key);
      return null;
    }
    return data.value;
  },
  remove(key) {
    wx.removeStorageSync(CACHE_PREFIX + key);
  },
  clear() {
    const keys = wx.getStorageInfoSync().keys;
    keys.forEach(key => {
      if (key.startsWith(CACHE_PREFIX)) {
        wx.removeStorageSync(key);
      }
    });
  }
};

module.exports = cache;

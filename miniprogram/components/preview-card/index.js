// components/preview-card/index.js —— 长按预览卡片（居中弹层）
Component({
  properties: {
    // 是否展示
    show: {
      type: Boolean,
      value: false
    },
    // 商品数据对象（由页面组装好展示字段）
    item: {
      type: Object,
      value: null
    }
  },

  data: {
    imgLoaded: false, // 图片是否加载完成（驱动骨架 → 淡入）
    imgError: false   // 图片是否加载失败（驱动占位兜底）
  },

  observers: {
    // 切换条目/换图时重置加载态，避免沿用上一条的状态
    'item.image': function () {
      this.setData({ imgLoaded: false, imgError: false });
    }
  },

  methods: {
    // 点击遮罩：仅关闭
    onMaskTap() {
      this.triggerEvent('close');
    },

    // 点击卡片：跳详情
    onCardTap() {
      const item = this.data.item;
      if (!item || !item._id) return;
      this.triggerEvent('opencard', { id: item._id });
    },

    onImgLoad() {
      if (!this.data.imgLoaded) this.setData({ imgLoaded: true });
    },

    onImgError() {
      this.setData({ imgError: true });
    },

    // 阻止背景滚动（catchtouchmove 需要一个方法占位）
    preventMove() {}
  }
});

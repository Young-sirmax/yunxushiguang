// pages/commodity_release/commodity_release.js
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const {
  COLLEGE_LIST,
  getMajorsByCollege,
  getCollegeByMajor,
  isBookCategoryName
} = require('../../utils/majors.js');
const { PRICE_UNITS, FALLBACK_SKILL_CATEGORIES, getSkillPriceRef, formatPriceRef } = require('../../utils/expert.js');
const { compressImages, remainCount, MAX_IMAGES_PER_POST, makeThumb } = require('../../utils/image.js');

const conditionOptions = ['全新', '99新', '9成新', '8成新', '7成新及以下'];

Page({
  data: {
    isEdit: false,
    commodityId: '',
    mode: 'sell',
    images: [],
    title: '',
    categoryList: [],
    selectedCategory: null,
    // 图书专区：分类为「书籍教材」时展示的「适用专业」多选
    isBookCategory: false,
    collegeList: COLLEGE_LIST,
    currentCollege: '',
    majorOptions: [],      // [{ name, checked }]
    selectedMajors: [],    // ['油气储运工程', ...]
    conditionOptions,
    condition: '',
    price: '',
    originalPrice: '',
    suggestedPrice: '',
    discountText: '',
    quantity: 1,
    tradeLocation: '',
    // 以物易物：期望交换物品（含常用标签）与可接受补差价
    exchangeWant: '',
    exchangeTags: ['教材', '数码', '日用品', '生活用品'],
    priceDiff: '',
    // 技能服务：报价模式 + 可服务时间
    priceUnits: PRICE_UNITS,
    priceUnitIndex: 0,
    priceUnit: 'per_time',
    availableTime: '',
    isExpert: false,
    // 技能服务：技能分类 + 该类目参考价提示（仅提示，不校验不拦截）
    // 技能分类列表来自 config 集合（app.getSkillCategories，缓存 1 小时），此处仅为初始兜底
    skillOptions: FALLBACK_SKILL_CATEGORIES,
    skillIndex: -1,
    skillCategory: '',
    priceRefText: '',
    // 求购分区：'' 未选择 | 'goods' 物品求购 | 'skill' 技能求助（必选）
    wantCategory: '',
    wantCategoryOptions: [
      { value: 'goods', icon: '📦', label: '物品求购' },
      { value: 'skill', icon: '🎓', label: '技能求助' }
    ],
    // 技能求助时选中的技能分类（作为求购帖的分类展示）
    wantSkillCategory: '',
    // 当前「分类」选择器的数据源：物品分类（categoryList）或技能分类（skillOptions）
    pickerRange: [],
    // 联系方式：改用账号微信号（只读，来自「个人信息」）
    wechatId: '',
    description: '',
    canSubmit: false,
    isSubmitting: false
  },

  async onLoad(options) {
    // 打开右上角“转发给朋友 / 分享到朋友圈”
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
    // 技能分类：优先读 config 配置（缓存 1 小时），失败回退兜底常量
    const skillOptions = await app.getSkillCategories();
    this.setData({ skillOptions });
    await this.loadCategoryList();
    const userInfo = wx.getStorageSync('userInfo') || {};
    // 技能分类默认取达人入驻时的第一个技能，省去重复选择
    const expertSkills = Array.isArray(userInfo.expert_skills) ? userInfo.expert_skills : [];
    const defaultSkillIndex = expertSkills.length > 0 ? skillOptions.indexOf(expertSkills[0]) : -1;

    this.setData({
      wechatId: userInfo.wechat_id || '',
      isExpert: userInfo.expert_status === 'approved',
      skillIndex: defaultSkillIndex,
      skillCategory: defaultSkillIndex > -1 ? skillOptions[defaultSkillIndex] : ''
    });
    this.refreshPriceRefTip();

    // 支持通过 type=sell / want / exchange / skill 直接定位发布类型
    if (options && ['sell', 'want', 'exchange', 'skill'].indexOf(options.type) > -1) {
      // 求购默认落在「物品求购」分区
      this.setData({
        mode: options.type,
        wantCategory: options.type === 'want' ? 'goods' : ''
      });
    }
    this.refreshPickerRange();

    if (options && options.mode === 'edit' && options.id) {
      this.setData({ isEdit: true, commodityId: options.id });
      this.loadCommodityData(options.id);
    }
    this.checkCanSubmit();
  },

  // 分类选择器数据源：求购+技能求助时列技能分类，其余列物品分类
  refreshPickerRange() {
    const { mode, wantCategory, skillOptions, categoryList } = this.data;
    const isSkillSeeking = mode === 'want' && wantCategory === 'skill';
    const pickerRange = isSkillSeeking
      ? (skillOptions || []).map(name => ({ _id: '', name }))
      : (categoryList || []);
    this.setData({ pickerRange });
  },

  // 选择求购分区（物品求购 / 技能求助）：切换后重置已选分类，避免脏数据
  onWantCategoryTap(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.wantCategory) return;
    this.setData({
      wantCategory: value,
      selectedCategory: null,
      wantSkillCategory: '',
      isBookCategory: false,
      currentCollege: '',
      majorOptions: [],
      selectedMajors: []
    });
    this.refreshPickerRange();
    this.checkCanSubmit();
  },

  onUnload() {
  },

  async loadCategoryList() {
    try {
      const res = await API.getCategoryList();
      if (res.code === 0) {
        this.setData({ categoryList: res.data || [] });
      }
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  },

  async loadCommodityData(id) {
    showLoading('加载中...');
    try {
      const res = await API.getCommodityDetail(id);
      if (res.code === 0) {
        const c = res.data;
        // 图书专区：回填「适用专业」
        const majors = Array.isArray(c.major) ? c.major : (c.major ? [c.major] : []);
        const college = majors.length ? getCollegeByMajor(majors[0]) : '';

        const mode = ['sell', 'want', 'exchange', 'skill'].indexOf(c.type) > -1 ? c.type : 'sell';
        // 求购分区：老数据没有 want_category 时按物品求购回填
        const wantCategory = mode === 'want' ? (c.want_category === 'skill' ? 'skill' : 'goods') : '';
        const wantSkillCategory = mode === 'want' && wantCategory === 'skill'
          ? (c.skill_category || c.categoryName || '')
          : '';

        this.setData({
          images: c.images || [],
          title: c.title,
          selectedCategory: mode === 'want' && wantCategory === 'skill'
            ? null
            : (this.data.categoryList.find(cat => cat._id === c.categoryId) || null),
          condition: c.condition,
          price: (c.type === 'sell' || c.type === 'skill') ? String(c.price || '') : '',
          originalPrice: c.originalPrice ? String(c.originalPrice) : '',
          quantity: c.quantity || 1,
          tradeLocation: c.tradeLocation,
          exchangeWant: c.exchange_want || '',
          priceDiff: c.accept_price_diff ? String(c.accept_price_diff) : '',
          priceUnit: c.price_unit || 'per_time',
          skillIndex: (this.data.skillOptions || []).indexOf(c.skill_category || ''),
          skillCategory: c.skill_category || '',
          priceUnitIndex: Math.max(0, PRICE_UNITS.findIndex(u => u.value === (c.price_unit || 'per_time'))),
          availableTime: c.available_time || '',
          description: c.description || '',
          mode,
          wantCategory,
          wantSkillCategory,
          isBookCategory: isBookCategoryName(c.categoryName),
          selectedMajors: majors,
          currentCollege: college,
          majorOptions: college
            ? getMajorsByCollege(college).map(name => ({ name, checked: majors.indexOf(name) > -1 }))
            : []
        });
        this.refreshPickerRange();
        this.calcSmartPrice();
        this.checkCanSubmit();
        this.refreshPriceRefTip();
      }
    } catch (err) {
      showToast('加载失败');
    } finally {
      hideLoading();
    }
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    const patch = { mode };
    // 切到求购：默认落在「物品求购」分区；切走求购：清掉分区选择
    if (mode === 'want') {
      if (!this.data.wantCategory) patch.wantCategory = 'goods';
    } else {
      patch.wantCategory = '';
      patch.wantSkillCategory = '';
    }
    this.setData(patch);
    this.refreshPickerRange();
    if (mode === 'skill') this.refreshPriceRefTip();
    this.checkCanSubmit();
  },

  // 选择技能分类 → 刷新参考价提示
  onSkillChange(e) {
    const index = Number(e.detail.value);
    const skillCategory = (this.data.skillOptions || [])[index] || '';
    this.setData({ skillIndex: index, skillCategory });
    this.refreshPriceRefTip();
  },

  // 参考价提示（config 里的 skill_price_ref 优先，前端默认表兜底；仅展示，不参与校验）
  async refreshPriceRefTip() {
    const skillCategory = this.data.skillCategory;
    if (!skillCategory) {
      this.setData({ priceRefText: '' });
      return;
    }
    let overrideTable = null;
    try {
      const cfg = await app.getAppConfig();
      overrideTable = cfg && cfg.skillPriceRef;
    } catch (err) {
      console.error('读取参考价配置失败，使用默认值:', err);
    }
    const ref = getSkillPriceRef(skillCategory, overrideTable);
    this.setData({ priceRefText: formatPriceRef(ref) });
  },

  chooseImage() {
    const remain = remainCount(this.data.images.length);
    if (remain <= 0) {
      showToast(`最多上传 ${MAX_IMAGES_PER_POST} 张图片`);
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFiles = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ images: this.data.images.concat(tempFiles) });
        this.checkCanSubmit();
      }
    });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.filter((_, i) => i !== index);
    this.setData({ images });
    this.checkCanSubmit();
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
    this.checkCanSubmit();
  },

  onCategoryChange(e) {
    const index = Number(e.detail.value);

    // 求购 + 技能求助：分类选择器列的是技能分类，单独存到 wantSkillCategory
    if (this.data.mode === 'want' && this.data.wantCategory === 'skill') {
      const skillName = ((this.data.skillOptions || [])[index]) || '';
      this.setData({
        wantSkillCategory: skillName,
        selectedCategory: null,
        isBookCategory: false,
        currentCollege: '',
        majorOptions: [],
        selectedMajors: []
      });
      this.checkCanSubmit();
      return;
    }

    const category = this.data.categoryList[index];
    const isBookCategory = isBookCategoryName(category && category.name);

    const patch = { selectedCategory: category, isBookCategory };
    // 切到非图书分类时，清掉已选专业，避免脏数据随发布提交
    if (!isBookCategory) {
      patch.currentCollege = '';
      patch.majorOptions = [];
      patch.selectedMajors = [];
    }
    this.setData(patch);
    this.checkCanSubmit();
    this.calcSmartPrice();
  },

  // ===== 图书专区：适用专业（多选） =====
  buildMajorOptions(college) {
    const selected = this.data.selectedMajors || [];
    return getMajorsByCollege(college).map(name => ({
      name,
      checked: selected.indexOf(name) > -1
    }));
  },

  selectBookCollege(e) {
    const college = e.currentTarget.dataset.college || '';
    this.setData({
      currentCollege: college,
      majorOptions: this.buildMajorOptions(college)
    });
  },

  toggleMajor(e) {
    const major = e.currentTarget.dataset.major;
    if (!major) return;
    const selected = (this.data.selectedMajors || []).slice();
    const idx = selected.indexOf(major);
    if (idx > -1) {
      selected.splice(idx, 1);
    } else {
      selected.push(major);
    }
    this.setData({
      selectedMajors: selected,
      majorOptions: (this.data.majorOptions || []).map(o => ({
        name: o.name,
        checked: selected.indexOf(o.name) > -1
      }))
    });
  },

  removeMajor(e) {
    const major = e.currentTarget.dataset.major;
    const selected = (this.data.selectedMajors || []).filter(m => m !== major);
    this.setData({
      selectedMajors: selected,
      majorOptions: (this.data.majorOptions || []).map(o => ({
        name: o.name,
        checked: selected.indexOf(o.name) > -1
      }))
    });
  },

  onConditionTap(e) {
    this.setData({ condition: e.currentTarget.dataset.value });
    this.checkCanSubmit();
    this.calcSmartPrice();
  },

  onPriceInput(e) {
    const price = e.detail.value;
    this.setData({ price });
    this.calcDiscount();
    this.checkCanSubmit();
  },

  onOriginalPriceInput(e) {
    const originalPrice = e.detail.value;
    this.setData({ originalPrice });
    this.calcSmartPrice();
    this.calcDiscount();
  },

  onQuantityInput(e) {
    let val = parseInt(e.detail.value) || 1;
    if (val < 1) val = 1;
    this.setData({ quantity: val });
  },

  increaseQty() {
    this.setData({ quantity: this.data.quantity + 1 });
  },

  decreaseQty() {
    if (this.data.quantity > 1) {
      this.setData({ quantity: this.data.quantity - 1 });
    }
  },

  onLocationInput(e) {
    this.setData({ tradeLocation: e.detail.value });
    this.checkCanSubmit();
  },

  // ===== 以物易物：期望交换物品 =====
  onExchangeWantInput(e) {
    this.setData({ exchangeWant: e.detail.value });
    this.checkCanSubmit();
  },

  // 点常用标签追加到「期望交换物品」
  appendExchangeTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const current = (this.data.exchangeWant || '').trim();
    if (!tag || current.indexOf(tag) > -1) return;
    const next = current ? `${current}、${tag}` : tag;
    this.setData({ exchangeWant: next });
    this.checkCanSubmit();
  },

  // 可接受补差价（元），选填
  onPriceDiffInput(e) {
    const value = (e.detail.value || '').replace(/[^\d.]/g, '');
    this.setData({ priceDiff: value });
  },

  // ===== 技能服务：报价模式 / 可服务时间 =====
  onPriceUnitChange(e) {
    const index = Number(e.detail.value) || 0;
    const unit = PRICE_UNITS[index] ? PRICE_UNITS[index].value : 'per_time';
    this.setData({ priceUnitIndex: index, priceUnit: unit });
    this.checkCanSubmit();
  },

  onAvailableTimeInput(e) {
    this.setData({ availableTime: e.detail.value || '' });
  },

  // 未入驻时引导去申请
  goExpertApply() {
    wx.navigateTo({ url: '/pages/expert_apply/expert_apply' });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  appendDesc(e) {
    const text = e.currentTarget.dataset.text;
    const current = this.data.description;
    const separator = current && !current.endsWith('\n') && current.length > 0 ? '\n' : '';
    this.setData({ description: current + separator + text });
  },

  calcDiscount() {
    const { price, originalPrice } = this.data;
    if (!price || !originalPrice) {
      this.setData({ discountText: '' });
      return;
    }
    const p = parseFloat(price);
    const op = parseFloat(originalPrice);
    if (!p || !op || p <= 0 || op <= 0) {
      this.setData({ discountText: '' });
      return;
    }
    const discount = (p / op * 10).toFixed(1);
    this.setData({ discountText: discount });
  },

  calcSmartPrice() {
    const { originalPrice, condition } = this.data;
    if (!originalPrice || !condition) {
      this.setData({ suggestedPrice: '' });
      return;
    }
    const op = parseFloat(originalPrice);
    if (isNaN(op) || op <= 0) return;

    const rates = { '全新': 0.85, '99新': 0.75, '9成新': 0.6, '8成新': 0.45, '7成新及以下': 0.35 };
    const rate = rates[condition] || 0.5;
    const suggested = Math.round(op * rate);
    this.setData({ suggestedPrice: suggested > 0 ? String(suggested) : '' });
  },

  checkCanSubmit() {
    const {
      mode, images, title, selectedCategory, condition,
      price, tradeLocation, exchangeWant, description
    } = this.data;

    // 求购必须先选分区（物品求购 / 技能求助）；技能求助还需选中技能分类
    if (mode === 'want') {
      if (!this.data.wantCategory) {
        this.setData({ canSubmit: false });
        return;
      }
      if (this.data.wantCategory === 'skill' && !(this.data.wantSkillCategory || '').trim()) {
        this.setData({ canSubmit: false });
        return;
      }
    }

    // 与服务端校验保持一致：闲置换让必须有合法价格，以物易物必须填期望交换物品
    if (mode === 'sell' && !(parseFloat(price) > 0)) {
      this.setData({ canSubmit: false });
      return;
    }
    if (mode === 'exchange' && !(exchangeWant || '').trim()) {
      this.setData({ canSubmit: false });
      return;
    }
    if (mode === 'skill') {
      const unit = this.data.priceUnit;
      const unitOk = ['per_time', 'per_hour', 'negotiable'].indexOf(unit) > -1;
      const priceOk = unit === 'negotiable' ? true : parseFloat(price) > 0;
      if (!unitOk || !priceOk) {
        this.setData({ canSubmit: false });
        return;
      }
    }

    const hasAny = images.length > 0
      || (title || '').trim()
      || (selectedCategory && selectedCategory.name)
      || condition
      || parseFloat(price) > 0
      || (tradeLocation || '').trim()
      || (exchangeWant || '').trim()
      || (description || '').trim();
    this.setData({ canSubmit: hasAny });
  },

  async uploadImages() {
    const { images } = this.data;
    const uploadedUrls = [];
    let thumb = '';

    // 上传前统一压缩（长边 1280 / 单张 ≤500KB）
    const compressed = await compressImages(images);

    for (let i = 0; i < compressed.length; i++) {
      const path = compressed[i];
      if (path.startsWith('cloud://') || path.startsWith('http')) {
        uploadedUrls.push(path);
        continue;
      }
      try {
        const res = await wx.cloud.uploadFile({
          cloudPath: `commodity/${Date.now()}_${i}.jpg`,
          filePath: path
        });
        uploadedUrls.push(res.fileID);
        // 首图额外导出小图：列表卡片与首页气泡只加载这张，详情页才用原图
        if (i === 0 && !thumb) {
          thumb = await this.uploadThumb(path);
        }
      } catch (err) {
        console.error('上传图片失败:', err);
      }
    }
    return { urls: uploadedUrls, thumb };
  },

  // 生成并上传首图缩略图（失败返回空串，调用方回退用原图，不阻断发布）
  async uploadThumb(localPath) {
    try {
      const thumbPath = await makeThumb(localPath, 'thumbCanvas');
      if (!thumbPath) return '';
      const res = await wx.cloud.uploadFile({
        cloudPath: `thumbs/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
        filePath: thumbPath
      });
      return res.fileID || '';
    } catch (err) {
      console.warn('生成/上传缩略图失败，回退原图:', err);
      return '';
    }
  },

  async submitForm() {
    if (!this.data.canSubmit || this.data.isSubmitting || this._submitLock) return;

    // 维护模式：写操作一律拒绝
    const cfg = await app.getAppConfig();
    if (cfg && cfg.maintenance) {
      showToast(cfg.notice || '系统维护中，请稍后再试');
      return;
    }

    // 求购必须先选分区（物品求购 / 技能求助）
    if (this.data.mode === 'want' && !this.data.wantCategory) {
      showToast('请先选择求购类型：物品求购 / 技能求助');
      return;
    }
    if (this.data.mode === 'want' && this.data.wantCategory === 'skill' && !(this.data.wantSkillCategory || '').trim()) {
      showToast('请选择技能分类');
      return;
    }

    // 技能服务需先完成达人入驻
    if (this.data.mode === 'skill' && !this.data.isExpert) {
      wx.showModal({
        title: '需要先入驻',
        content: '发布技能服务需要先完成「技能达人入驻」，现在去申请吗？',
        confirmText: '去入驻',
        success: (res) => {
          if (res.confirm) this.goExpertApply();
        }
      });
      return;
    }

    this._submitLock = true;
    this.setData({ isSubmitting: true });
    showLoading(this.data.isEdit ? '保存中...' : '发布中...');

    try {
      // 同时产出首图缩略图（列表/气泡用小图，详情页用原图）
      const { urls: imageUrls, thumb } = await this.uploadImages();
      const userInfo = wx.getStorageSync('userInfo');
      const { mode } = this.data;

      // 求购·技能求助：技能分类即该帖的分类（用于列表展示；categoryId 留空）
      const isSkillSeeking = mode === 'want' && this.data.wantCategory === 'skill';

      const data = {
        title: this.data.title.trim(),
        categoryId: isSkillSeeking ? '' : (this.data.selectedCategory ? this.data.selectedCategory._id : ''),
        categoryName: isSkillSeeking
          ? this.data.wantSkillCategory
          : (this.data.selectedCategory ? this.data.selectedCategory.name : ''),
        // 求购分区：物品求购 / 技能求助
        want_category: mode === 'want' ? this.data.wantCategory : '',
        condition: mode === 'skill' ? '' : this.data.condition,
        price: (mode === 'sell' || (mode === 'skill' && this.data.priceUnit !== 'negotiable'))
          ? (parseFloat(this.data.price) || 0)
          : 0,
        // 技能服务：报价模式 + 可服务时间
        price_unit: mode === 'skill' ? this.data.priceUnit : '',
        // 技能分类（仅技能服务，选填；用于展示该类目参考价）
        skill_category: mode === 'skill' ? this.data.skillCategory : '',
        available_time: mode === 'skill' ? (this.data.availableTime || '').trim() : '',
        originalPrice: this.data.originalPrice ? parseFloat(this.data.originalPrice) : 0,
        quantity: parseInt(this.data.quantity) || 1,
        tradeLocation: this.data.tradeLocation,
        description: this.data.description.trim(),
        images: imageUrls,
        // 首图缩略图：只在本次新生成时携带，避免编辑时把已有 thumb 清空
        ...(thumb ? { thumb } : {}),
        sellerName: userInfo.nickName,
        sellerAvatar: userInfo.avatarUrl,
        universityId: userInfo.universityId,
        universityName: userInfo.universityName,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: mode,
        // 以物易物：期望交换物品（必填）与可接受补差价（选填）
        exchange_want: mode === 'exchange' ? this.data.exchangeWant.trim() : '',
        accept_price_diff: mode === 'exchange' && parseFloat(this.data.priceDiff) > 0
          ? parseFloat(this.data.priceDiff)
          : null,
        // 图书专区：适用专业（数组）；非图书分类统一置空
        major: this.data.isBookCategory ? this.data.selectedMajors : []
      };

      let res;
      if (this.data.isEdit) {
        res = await API.updateCommodity(this.data.commodityId, data);
      } else {
        res = await API.createCommodity(data);
      }

      hideLoading();
      this.setData({ isSubmitting: false });

      if (res.code === 0) {
        const successMsg = this.data.isEdit
          ? '修改成功，等待管理员审核'
          : '发布成功，等待管理员审核';
        showToast(successMsg);
        setTimeout(() => {
          this._submitLock = false;
          wx.switchTab({ url: '/pages/commodity_list/commodity_list' });
        }, 1500);
      } else {
        this._submitLock = false;
        showToast(res.msg || '操作失败');
      }
    } catch (err) {
      hideLoading();
      this.setData({ isSubmitting: false });
      this._submitLock = false;
      showToast('操作失败，请重试');
      console.error(err);
    }
  },

  onShareAppMessage() {
    return {
      title: '云叙石光 · 免费发布闲置 / 求购，快到校园圈子里看看吧',
      path: '/pages/commodity_list/commodity_list'
    };
  },

  onShareTimeline() {
    return { title: '云叙石光 · 校园物品信息服务平台', query: '' };
  }
});
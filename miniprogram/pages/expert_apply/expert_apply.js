// pages/expert_apply/expert_apply.js —— 技能达人入驻申请
const app = getApp();
const API = require('../../api/api.js');
const { showToast, showLoading, hideLoading, buildCloudPath } = require('../../utils/util.js');
const { FALLBACK_SKILL_CATEGORIES, PRICE_UNITS } = require('../../utils/expert.js');
const { compressImages } = require('../../utils/image.js');

const MAX_CERTS = 4;

Page({
  data: {
    // 技能分类：来自 config 配置（app.getSkillCategories），此处为兜底初值
    skillCategories: FALLBACK_SKILL_CATEGORIES,
    skillOptions: FALLBACK_SKILL_CATEGORIES.map(name => ({ name, checked: false })),
    selectedSkills: [],
    intro: '',
    introLen: 0,
    certs: [],            // 本地临时图 / cloud fileID
    priceUnits: PRICE_UNITS,
    priceUnitIndex: 2,    // 默认「面议」
    priceUnit: 'negotiable',
    price: '',
    availableTime: '',
    canSubmit: false,
    isSubmitting: false,
    isEdit: false
  },

  async onLoad() {
    // 技能分类：优先读 config 配置（缓存 1 小时），失败回退兜底常量
    const skillCategories = await app.getSkillCategories();
    this.setData({ skillCategories, skillOptions: this.buildSkillOptions([]) });

    // 若已有入驻资料（驳回后重新申请 / 已通过后修改），回填
    const userInfo = wx.getStorageSync('userInfo') || {};
    if (userInfo.expert_status && userInfo.expert_status !== 'none') {
      const skills = Array.isArray(userInfo.expert_skills) ? userInfo.expert_skills : [];
      const unit = userInfo.expert_price_unit || 'negotiable';
      const index = Math.max(0, PRICE_UNITS.findIndex(u => u.value === unit));
      this.setData({
        isEdit: true,
        selectedSkills: skills,
        skillOptions: this.buildSkillOptions(skills),
        intro: userInfo.expert_intro || '',
        introLen: (userInfo.expert_intro || '').length,
        certs: Array.isArray(userInfo.expert_certs) ? userInfo.expert_certs : [],
        priceUnit: unit,
        priceUnitIndex: index,
        price: userInfo.expert_price ? String(userInfo.expert_price) : '',
        availableTime: userInfo.expert_available_time || ''
      });
    }
    this.checkCanSubmit();
  },

  // 按当前技能分类列表生成选项（勾选态由 selected 决定）
  buildSkillOptions(selected) {
    const chosen = Array.isArray(selected) ? selected : [];
    return (this.data.skillCategories || []).map(name => ({
      name,
      checked: chosen.indexOf(name) > -1
    }));
  },

  toggleSkill(e) {
    const name = e.currentTarget.dataset.name;
    const selected = (this.data.selectedSkills || []).slice();
    const idx = selected.indexOf(name);
    if (idx > -1) selected.splice(idx, 1);
    else selected.push(name);

    this.setData({
      selectedSkills: selected,
      skillOptions: this.buildSkillOptions(selected)
    });
    this.checkCanSubmit();
  },

  onIntroInput(e) {
    const intro = e.detail.value || '';
    this.setData({ intro, introLen: intro.length });
    this.checkCanSubmit();
  },

  chooseCerts() {
    const remain = MAX_CERTS - this.data.certs.length;
    if (remain <= 0) {
      showToast('最多上传4张证明图');
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ certs: this.data.certs.concat(paths) });
      }
    });
  },

  previewCert(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      current: this.data.certs[index],
      urls: this.data.certs
    });
  },

  deleteCert(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ certs: this.data.certs.filter((_, i) => i !== index) });
  },

  onPriceUnitChange(e) {
    const index = Number(e.detail.value) || 0;
    const unit = PRICE_UNITS[index] ? PRICE_UNITS[index].value : 'negotiable';
    this.setData({ priceUnitIndex: index, priceUnit: unit });
    this.checkCanSubmit();
  },

  onPriceInput(e) {
    const price = (e.detail.value || '').replace(/[^\d.]/g, '');
    this.setData({ price });
    this.checkCanSubmit();
  },

  onTimeInput(e) {
    this.setData({ availableTime: e.detail.value || '' });
  },

  checkCanSubmit() {
    const { selectedSkills, intro, priceUnit, price } = this.data;
    const skillsOk = selectedSkills.length > 0;
    const introOk = (intro || '').trim().length > 0 && intro.length <= 200;
    const priceOk = priceUnit === 'negotiable' ? true : parseFloat(price) > 0;
    this.setData({ canSubmit: skillsOk && introOk && priceOk });
  },

  async uploadCerts() {
    const { certs } = this.data;
    const uploaded = [];
    const compressed = await compressImages(certs);
    for (let i = 0; i < compressed.length; i++) {
      const path = compressed[i];
      if (path.indexOf('cloud://') === 0 || path.indexOf('http') === 0) {
        uploaded.push(path);
        continue;
      }
      try {
        const res = await wx.cloud.uploadFile({
          cloudPath: buildCloudPath('expert', path),
          filePath: path
        });
        uploaded.push(res.fileID);
      } catch (err) {
        console.error('证明图上传失败:', err);
      }
    }
    return uploaded;
  },

  async submit() {
    if (!this.data.canSubmit || this.data.isSubmitting) return;

    const { selectedSkills, intro, priceUnit, price, availableTime } = this.data;
    if (selectedSkills.length === 0) {
      showToast('请至少选择一项技能分类');
      return;
    }
    if (!intro.trim()) {
      showToast('请填写个人介绍');
      return;
    }
    if (priceUnit !== 'negotiable' && !(parseFloat(price) > 0)) {
      showToast('请填写参考报价金额');
      return;
    }

    this.setData({ isSubmitting: true });
    showLoading('提交中...');
    try {
      const certs = await this.uploadCerts();
      const res = await API.expertApply({
        expert_skills: selectedSkills,
        expert_intro: intro.trim(),
        expert_certs: certs,
        expert_price_unit: priceUnit,
        expert_price: priceUnit === 'negotiable' ? null : parseFloat(price),
        expert_available_time: availableTime.trim()
      });
      hideLoading();
      this.setData({ isSubmitting: false });
      if (res.code === 0) {
        app.syncUserInfo(res.data);
        showToast(res.msg || '已开通技能达人');
        setTimeout(() => wx.navigateBack(), 1200);
      } else {
        showToast(res.msg || '提交失败');
      }
    } catch (err) {
      hideLoading();
      this.setData({ isSubmitting: false });
      showToast(err.message || '提交失败，请重试');
    }
  }
});

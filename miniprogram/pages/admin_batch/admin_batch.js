// pages/admin_batch/admin_batch.js —— 管理员批量上架（仅白名单可用）
//
// 三条路径：
//  1) 表格导入：CSV（title, description, price, category, type, image_filename1~6）+ 图片 zip
//  2) 手动录入：逐条表单
//  3) 待上架：确认后逐条/批量转 onSale
//
// 说明：CSV 解析为本地轻量实现（支持引号包裹/逗号/换行），不引入依赖。

const app = getApp();
const API = require('../../api/api.js');
const NATIVE_COLORS = require('../../utils/nativeColors.js');
const { showToast, showLoading, hideLoading } = require('../../utils/util.js');
const { compressImages } = require('../../utils/image.js');
const { formatSkillPrice } = require('../../utils/expert.js');

const TYPE_OPTIONS = [
  { value: 'sell', label: '闲置转让' },
  { value: 'want', label: '求购' },
  { value: 'exchange', label: '以物易物' },
  { value: 'skill', label: '技能服务' }
];

const PRICE_UNIT_OPTIONS = [
  { value: 'per_time', label: '按次' },
  { value: 'per_hour', label: '按小时' },
  { value: 'negotiable', label: '面议' }
];

const MAX_IMAGES = 6;
const IMPORT_BATCH = 50;   // 单次导入行数（与云函数上限一致）

// ===================== 轻量 CSV 解析 =====================
function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, ''); // 去 BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') { field += c; }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v || '').trim() !== ''));
}

function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[\s_\-()（）]/g, '');
}

Page({
  data: {
    tab: 'csv',                 // csv | manual | drafts
    typeOptions: TYPE_OPTIONS,
    priceUnitOptions: PRICE_UNIT_OPTIONS,
    maxImages: MAX_IMAGES,

    // ===== 表格导入 =====
    csvFileName: '',
    totalRows: 0,
    rows: [],                   // { rowNo, title, ..., imageNames, images, imgState: ok|missing }
    zipFileName: '',
    imageMap: null,
    uploadingZip: false,
    importing: false,
    importProgress: 0,
    importSummary: '',
    failedRows: [],             // { rowNo, error }

    // ===== 手动录入 =====
    categoryList: [],
    manualImages: [],
    manualTitle: '',
    manualDesc: '',
    manualPrice: '',
    manualTypeIndex: 0,
    manualCategoryIndex: 0,
    manualSubmitting: false,

    // ===== 待上架 =====
    drafts: [],
    draftsTotal: 0,
    draftsLoading: false,
    publishingId: ''
  },

  onLoad() {
    this.checkPermission();
    this.loadCategories();
  },

  async checkPermission() {
    const cfg = await app.getAppConfig(true);
    if (!cfg || !cfg.canBatch) {
      wx.showModal({
        title: '无权限',
        content: '当前账号不在批量上架白名单内。请在 config 集合 app 记录的 admin_openids 中加入你的 openid。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
    }
  },

  async loadCategories() {
    try {
      const res = await API.getCategoryList();
      if (res.code === 0) this.setData({ categoryList: res.data || [] });
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab === 'drafts') this.loadDrafts();
  },

  // ===================== 表格导入 =====================

  // 选择 CSV
  chooseCSV() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.readCSV(file.path, file.name);
      },
      fail: () => showToast('未选择文件（可先发到微信「文件传输助手」再选择）')
    });
  },

  readCSV(filePath, fileName) {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf-8',
      success: (res) => {
        try {
          const rows = this.buildRows(parseCSV(res.data));
          if (rows.length === 0) {
            showToast('CSV 没有有效数据行（请检查表头与编码为 UTF-8）');
            return;
          }
          this.setData({
            csvFileName: fileName || 'data.csv',
            rows,
            totalRows: rows.length,
            failedRows: [],
            importSummary: ''
          });
          this.matchImages();
          showToast(`已解析 ${rows.length} 行`);
        } catch (err) {
          console.error('CSV 解析失败:', err);
          showToast('CSV 解析失败，请检查格式');
        }
      },
      fail: () => showToast('读取 CSV 失败')
    });
  },

  // 表头 → 数据行
  buildRows(table) {
    if (!table || table.length < 2) return [];
    const header = table[0].map(h => String(h || '').trim().toLowerCase());
    const idx = (name) => header.indexOf(name.toLowerCase());

    const iTitle = idx('title');
    const iDesc = idx('description');
    const iPrice = idx('price');
    const iCategory = idx('category');
    const iType = idx('type');
    const iCondition = idx('condition');
    const iLocation = idx('tradeLocation') > -1 ? idx('tradeLocation') : idx('tradelocation');
    const iPriceUnit = idx('price_unit') > -1 ? idx('price_unit') : idx('priceunit');
    const iExchange = idx('exchange_want') > -1 ? idx('exchange_want') : idx('exchangewant');
    const imgIdx = [];
    for (let n = 1; n <= MAX_IMAGES; n++) {
      const at = idx('image_filename' + n);
      if (at > -1) imgIdx.push(at);
    }

    const rows = [];
    for (let r = 1; r < table.length; r++) {
      const line = table[r];
      const pick = (i) => (i > -1 && line[i] != null ? String(line[i]).trim() : '');
      const title = pick(iTitle);
      if (!title) continue; // 跳过空行

      const type = TYPE_OPTIONS.some(t => t.value === pick(iType)) ? pick(iType) : 'sell';
      rows.push({
        rowNo: r + 1,                 // CSV 实际行号（含表头）
        title,
        description: pick(iDesc),
        price: pick(iPrice),
        category: pick(iCategory),
        type,
        condition: pick(iCondition),
        tradeLocation: pick(iLocation),
        priceUnit: pick(iPriceUnit) || 'negotiable',
        exchangeWant: pick(iExchange),
        imageNames: imgIdx.map(i => pick(i)).filter(Boolean),
        images: [],
        imgState: 'pending'           // ok | missing | none
      });
    }
    return rows;
  },

  // 选择并上传图片 zip
  chooseZip() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['zip'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.uploadAndUnzip(file);
      },
      fail: () => showToast('未选择压缩包（可先发到微信「文件传输助手」再选择）')
    });
  },

  async uploadAndUnzip(file) {
    if (this.data.uploadingZip) return;
    this.setData({ uploadingZip: true });
    showLoading('上传压缩包...');
    try {
      const up = await wx.cloud.uploadFile({
        cloudPath: `batch-zip/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.zip`,
        filePath: file.path
      });
      hideLoading();
      showLoading('解压图片中...');
      const res = await API.batchUnzipImages(up.fileID);
      hideLoading();
      this.setData({ uploadingZip: false });

      if (res.code !== 0) {
        showToast(res.msg || '解压失败');
        return;
      }
      const data = res.data || {};
      this.setData({
        zipFileName: file.name || 'images.zip',
        imageMap: data.map || {}
      });
      this.matchImages();
      const extra = data.truncated ? `（压缩包内共 ${data.zipImageTotal} 张，本次仅处理前 ${data.uploadedCount} 张，请拆分后再传）` : '';
      wx.showModal({
        title: '图片已就绪',
        content: `成功上传 ${data.uploadedCount} 张图片${extra}`,
        showCancel: false
      });
    } catch (err) {
      hideLoading();
      this.setData({ uploadingZip: false });
      showToast(err.message || '上传/解压失败');
    }
  },

  // 按文件名匹配图片（宽松匹配：忽略大小写/扩展名/空格下划线）
  matchImages() {
    const { rows, imageMap } = this.data;
    if (!imageMap || !rows.length) return;

    let ok = 0;
    let missing = 0;
    const next = rows.map(row => {
      if (!row.imageNames.length) {
        return Object.assign({}, row, { images: [], imgState: 'none' });
      }
      const ids = [];
      row.imageNames.forEach(name => {
        const hit = imageMap[String(name).toLowerCase()] || imageMap[normalizeKey(name)];
        if (hit) ids.push(hit);
      });
      if (ids.length === 0) missing += 1; else ok += 1;
      return Object.assign({}, row, {
        images: ids.slice(0, MAX_IMAGES),
        imgState: ids.length === 0 ? 'missing' : 'ok'
      });
    });

    this.setData({ rows: next });
    if (missing > 0) showToast(`已匹配 ${ok} 行，${missing} 行图片缺失`);
  },

  // 处理图片缺失行：跳过 / 无图导入
  toggleSkipRow(e) {
    const rowNo = Number(e.currentTarget.dataset.row);
    const rows = this.data.rows.map(r => (r.rowNo === rowNo ? Object.assign({}, r, { skipped: !r.skipped }) : r));
    this.setData({ rows });
  },

  // 执行导入（分批）
  async startImport() {
    if (this.data.importing) return;
    const target = this.data.rows.filter(r => !r.skipped);
    if (target.length === 0) {
      showToast('没有可导入的行');
      return;
    }

    this.setData({ importing: true, importProgress: 0, failedRows: [], importSummary: '' });
    const batchId = `batch_${Date.now()}`;
    let done = 0;
    let okCount = 0;
    const failed = [];

    for (let i = 0; i < target.length; i += IMPORT_BATCH) {
      const chunk = target.slice(i, i + IMPORT_BATCH).map(r => ({
        rowNo: r.rowNo,
        title: r.title,
        description: r.description,
        price: r.price,
        category: r.category,
        type: r.type,
        condition: r.condition,
        tradeLocation: r.tradeLocation,
        priceUnit: r.priceUnit,
        exchangeWant: r.exchangeWant,
        images: r.images
      }));

      try {
        const res = await API.batchImportRows(chunk, batchId);
        const results = (res.data && res.data.results) || [];
        results.forEach(item => {
          if (item.ok) okCount += 1;
          else failed.push({ rowNo: item.rowNo, error: item.error || '导入失败' });
        });
      } catch (err) {
        chunk.forEach(c => failed.push({ rowNo: c.rowNo, error: err.message || '请求失败' }));
      }

      done = Math.min(i + IMPORT_BATCH, target.length);
      this.setData({ importProgress: Math.floor(done / target.length * 100) });
    }

    // 成功的行标记为"已导入"（skipped=true），避免重复提交；失败行保持可重试
    const failedSet = {};
    failed.forEach(f => { failedSet[f.rowNo] = true; });
    const updatedRows = this.data.rows.map(r => (
      r.skipped ? r : Object.assign({}, r, { skipped: !failedSet[r.rowNo] })
    ));

    this.setData({
      rows: updatedRows,
      importing: false,
      failedRows: failed,
      importSummary: `成功 ${okCount} 条，失败 ${failed.length} 条（可在下方查看并重试）`
    });
    this.loadDrafts();
    wx.showModal({
      title: '导入完成',
      content: `成功 ${okCount} 条，失败 ${failed.length} 条。成功的条目在「待上架」中确认上架。`,
      showCancel: false
    });
  },

  // 重试失败行（失败行已在导入结束时保持"未跳过"，直接再跑一次即可）
  async retryFailed() {
    const failed = this.data.failedRows;
    if (!failed.length) return;
    const map = {};
    failed.forEach(f => { map[f.rowNo] = true; });
    const remain = this.data.rows.filter(r => map[r.rowNo]);
    if (!remain.length) {
      showToast('失败行已不在当前列表，请重新选择文件');
      return;
    }
    await this.startImport();
  },

  // ===================== 手动录入 =====================

  chooseManualImages() {
    const remain = MAX_IMAGES - this.data.manualImages.length;
    if (remain <= 0) {
      showToast(`最多 ${MAX_IMAGES} 张`);
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = res.tempFiles.map(f => f.tempFilePath);
        this.setData({ manualImages: this.data.manualImages.concat(paths) });
      }
    });
  },

  deleteManualImage(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ manualImages: this.data.manualImages.filter((_, i) => i !== index) });
  },

  onManualInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch[field] = e.detail.value;
    this.setData(patch);
  },

  onManualTypeChange(e) {
    this.setData({ manualTypeIndex: Number(e.detail.value) || 0 });
  },

  onManualCategoryChange(e) {
    this.setData({ manualCategoryIndex: Number(e.detail.value) || 0 });
  },

  async submitManual() {
    if (this.data.manualSubmitting) return;
    const { manualImages, manualTitle, manualDesc, manualPrice, manualTypeIndex, manualCategoryIndex, categoryList } = this.data;

    const type = TYPE_OPTIONS[manualTypeIndex] ? TYPE_OPTIONS[manualTypeIndex].value : 'sell';
    if (!manualTitle.trim()) {
      showToast('请填写标题');
      return;
    }
    if (type === 'sell' && !(parseFloat(manualPrice) > 0)) {
      showToast('闲置转让需填写价格');
      return;
    }

    this.setData({ manualSubmitting: true });
    showLoading('提交中...');
    try {
      // 压缩并上传图片
      let imageIds = [];
      if (manualImages.length) {
        const compressed = await compressImages(manualImages);
        for (let i = 0; i < compressed.length; i++) {
          const path = compressed[i];
          if (path.indexOf('cloud://') === 0) { imageIds.push(path); continue; }
          const up = await wx.cloud.uploadFile({
            cloudPath: `batch/${Date.now()}_${i}.jpg`,
            filePath: path
          });
          imageIds.push(up.fileID);
        }
      }

      const category = categoryList[manualCategoryIndex];
      const res = await API.batchImportRows([{
        rowNo: 0,
        title: manualTitle.trim(),
        description: manualDesc.trim(),
        price: manualPrice,
        category: category ? category.name : '',
        type,
        priceUnit: 'negotiable',
        images: imageIds
      }], `manual_${Date.now()}`);

      hideLoading();
      this.setData({ manualSubmitting: false });

      const result = res.data && res.data.results && res.data.results[0];
      if (result && result.ok) {
        showToast('已加入待上架');
        this.setData({ manualImages: [], manualTitle: '', manualDesc: '', manualPrice: '' });
        this.loadDrafts();
      } else {
        showToast((result && result.error) || res.msg || '提交失败');
      }
    } catch (err) {
      hideLoading();
      this.setData({ manualSubmitting: false });
      showToast(err.message || '提交失败');
    }
  },

  // ===================== 待上架 =====================

  async loadDrafts() {
    this.setData({ draftsLoading: true });
    try {
      const res = await API.batchListDrafts({ page: 1, pageSize: 20 });
      const list = (res.data || []).map(item => Object.assign({}, item, {
        priceText: item.type === 'skill'
          ? formatSkillPrice(item.price_unit, item.price)
          : (item.price > 0 ? '¥' + item.price : '面议')
      }));
      this.setData({ drafts: list, draftsTotal: res.total || 0, draftsLoading: false });
    } catch (err) {
      this.setData({ draftsLoading: false });
      showToast(err.message || '加载失败');
    }
  },

  publishOne(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认上架',
      content: '上架后该信息将立即出现在首页（不影响其他条目）。',
      confirmText: '上架',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ publishingId: id });
        try {
          const apiRes = await API.batchPublishDraft(id);
          showToast(apiRes.msg || '已上架');
          this.loadDrafts();
        } catch (err) {
          showToast(err.message || '上架失败');
        } finally {
          this.setData({ publishingId: '' });
        }
      }
    });
  },

  publishAll() {
    if (!this.data.drafts.length) return;
    wx.showModal({
      title: '全部上架',
      content: `确认将当前页 ${this.data.drafts.length} 条待上架信息全部上架？`,
      confirmText: '全部上架',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('上架中...');
        let ok = 0;
        for (let i = 0; i < this.data.drafts.length; i++) {
          try {
            await API.batchPublishDraft(this.data.drafts[i]._id);
            ok += 1;
          } catch (err) { /* 单条失败不阻断 */ }
        }
        hideLoading();
        showToast(`已上架 ${ok} 条`);
        this.loadDrafts();
      }
    });
  },

  deleteDraft(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除待上架',
      content: '将删除该条信息及其图片，且不可恢复。',
      confirmText: '删除',
      confirmColor: NATIVE_COLORS.error,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await API.batchDeleteDraft(id);
          showToast('已删除');
          this.loadDrafts();
        } catch (err) {
          showToast(err.message || '删除失败');
        }
      }
    });
  },

  previewDraft(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  goMaintenance() {
    wx.showModal({
      title: '维护模式',
      content: '本页顶部提示位对应现有维护模式开关：在云开发控制台 config 集合的 app 记录中，把 maintenance 改为 true 即全站只读；改回 false 即恢复。详见 docs/运维手册.md 第三节。',
      showCancel: false
    });
  }
});

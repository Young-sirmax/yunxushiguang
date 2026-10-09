// pages/admin_batch/admin_batch.js —— 批量上架 v2（权限：超管 / 被授权人）
//
// 四条路径：
//  1) 极简上架（默认）：相册直选 → 填价 → 导入待上架 → 一键全部上架。只要「一张图 + 一个价格」。
//  2) 待上架：确认后逐条/批量转 onSale
//  3) 高级（默认不露出）：CSV + ZIP 表格导入 / 单件手动录入
//  4) 授权（仅超管可见）：站内授权 / 回收 / 邀请卡，替代去云开发控制台改白名单
//
// 说明：CSV 解析为本地轻量实现（支持引号包裹/逗号/换行），不引入依赖。

const app = getApp();
const API = require('../../api/api.js');
const NATIVE_COLORS = require('../../utils/nativeColors.js');
const { showToast, showLoading, hideLoading, formatDate } = require('../../utils/util.js');
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
const IMPORT_BATCH = 50;        // 单次导入行数（与云函数上限一致）
const PUBLISH_BATCH = 50;       // 单次上架条数（与云函数 publishBatch 上限一致）
const SIMPLE_MAX = 50;          // 极简模式单批图片上限（指令 5.1）
const SIMPLE_STORAGE_KEY = 'batchSimpleDraft';   // 断点保护（指令 6）
const SIMPLE_RESTORE_TTL = 24 * 60 * 60 * 1000;  // 恢复的草稿最长保留 24 小时
const SIMPLE_ID_MAX = 200;      // 落盘的「已导入未上架」id 上限，避免 storage 无限增长

let uidSeed = 0;
function genUid() {
  uidSeed += 1;
  return `${Date.now().toString(36)}_${uidSeed}_${Math.random().toString(36).slice(2, 6)}`;
}

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
    tab: 'simple',              // simple | drafts | advanced | admin
    advTab: 'csv',              // csv | manual
    typeOptions: TYPE_OPTIONS,
    priceUnitOptions: PRICE_UNIT_OPTIONS,
    maxImages: MAX_IMAGES,
    simpleMax: SIMPLE_MAX,
    isSuper: false,

    // ===== 极简上架 =====
    // item: { uid, path, fileName, fileID, status: pending|uploading|done|fail, price, error }
    simpleItems: [],
    simpleImportedIds: [],
    simpleBusy: false,
    simpleSummary: '',

    // ===== 表格导入（高级） =====
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

    // ===== 手动录入（高级） =====
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
    publishingId: '',
    publishingAll: false,

    // ===== 授权（仅超管） =====
    adminLoading: false,
    adminList: [],
    grantKeyword: '',
    grantCandidates: [],
    grantNote: '',
    inviteToken: '',
    inviteNote: '',
    inviteCreating: false
  },

  onLoad() {
    this._simplePrices = {};
    this.checkPermission();
    this.loadCategories();
    this.restoreSimpleDraft();
  },

  onShow() {
    // 待上架数量在从「极简上架」导入后会变化，回到本页时刷新一次
    if (this.data.tab === 'drafts') this.loadDrafts();
  },

  async checkPermission() {
    const cfg = await app.getAppConfig(true);

    // 拉取失败 ≠ 无权限：网络抖动时不能把合法管理员挡在门外，给一次重试机会
    if (!cfg || cfg.configUnavailable) {
      wx.showModal({
        title: '网络异常',
        content: '权限校验失败，请检查网络后重试。',
        confirmText: '重试',
        success: (res) => {
          if (res.confirm) this.checkPermission();
          else wx.navigateBack();
        }
      });
      return;
    }

    if (!cfg.canBatch) {
      wx.showModal({
        title: '无权限',
        content: '当前账号没有批量上架权限。请联系管理员在小程序「批量上架 → 授权」中开通。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }

    this.setData({ isSuper: !!cfg.isSuper });
    if (cfg.isSuper) this.loadAdmins();
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
    if (tab === 'admin' && this.data.isSuper) this.loadAdmins();
  },

  switchAdvTab(e) {
    this.setData({ advTab: e.currentTarget.dataset.tab });
  },

  // ===================== 极简上架（默认主流程） =====================

  // 断点保护：已上传的图片 fileID、已填价格、已导入但未上架的 draft id 一并写入本地 storage（指令 6）
  persistSimple() {
    try {
      const items = this.data.simpleItems
        .filter(it => it.fileID)
        .map(it => ({
          uid: it.uid,
          fileID: it.fileID,
          fileName: it.fileName || '',
          price: this.priceOf(it)
        }));
      wx.setStorageSync(SIMPLE_STORAGE_KEY, {
        time: Date.now(),
        items,
        // 已导入未上架的草稿 id 也要落盘，否则重进小程序后「一键全部上架」入口会消失
        importedIds: this.data.simpleImportedIds.slice(0, SIMPLE_ID_MAX)
      });
    } catch (err) {
      // 存储失败不影响上架主流程
      console.warn('保存极简草稿失败:', err);
    }
  },

  restoreSimpleDraft() {
    let saved = null;
    try {
      saved = wx.getStorageSync(SIMPLE_STORAGE_KEY);
    } catch (err) {
      return;
    }
    if (!saved) return;
    if (Date.now() - (saved.time || 0) > SIMPLE_RESTORE_TTL) {
      wx.removeStorageSync(SIMPLE_STORAGE_KEY);
      return;
    }

    const savedItems = Array.isArray(saved.items) ? saved.items : [];
    const savedIds = Array.isArray(saved.importedIds) ? saved.importedIds : [];
    if (savedItems.length === 0 && savedIds.length === 0) return;

    const items = savedItems.map(it => ({
      uid: it.uid || genUid(),
      path: '',
      fileName: it.fileName || '',
      fileID: it.fileID,
      status: 'done',
      price: it.price || '',
      error: ''
    }));
    items.forEach(it => { this._simplePrices[it.uid] = it.price; });

    this.setData({ simpleItems: items, simpleImportedIds: savedIds });
    showToast(`已恢复上次未完成的 ${items.length} 件${savedIds.length ? `、${savedIds.length} 条待上架` : ''}`);
  },

  /** 取某条的当前价格：以内存里的实时输入为准，其次用 data 上的值 */
  priceOf(item) {
    if (!item) return '';
    const live = this._simplePrices[item.uid];
    if (live !== undefined && live !== null && String(live) !== '') return String(live);
    return String(item.price || '');
  },

  setSimpleItem(index, patch) {
    const data = {};
    Object.keys(patch).forEach(k => { data[`simpleItems[${index}].${k}`] = patch[k]; });
    this.setData(data);
  },

  // 选图：相册 / 拍摄，可多选、可多次追加
  chooseSimpleImages() {
    const remain = SIMPLE_MAX - this.data.simpleItems.length;
    if (remain <= 0) {
      showToast(`单批最多 ${SIMPLE_MAX} 张，请先导入本批`);
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        // 注意：wx.chooseMedia 不返回相册里的原始文件名（f.name 通常为空），
        // 故极简模式实际会落到「闲置 MMDD N/M」的自动标题规则。
        const added = (res.tempFiles || []).map(f => ({
          uid: genUid(),
          path: f.tempFilePath,
          fileName: f.name || '',
          fileID: '',
          status: 'pending',
          price: '',
          error: ''
        }));
        if (added.length === 0) return;
        this.setData({ simpleItems: this.data.simpleItems.concat(added) }, () => {
          added.forEach(it => this.uploadSimpleItem(it.uid));
        });
      }
    });
  },

  // 单张上传：压缩 → 云存储。每张独立状态，失败只标该条，不整批回滚（指令 6）
  async uploadSimpleItem(uid) {
    let index = this.data.simpleItems.findIndex(i => i.uid === uid);
    if (index < 0) return;
    if (this.data.simpleItems[index].fileID) return;

    this.setSimpleItem(index, { status: 'uploading', error: '' });
    try {
      const compressed = await compressImages([this.data.simpleItems[index].path]);
      const filePath = (compressed && compressed[0]) || this.data.simpleItems[index].path;

      const up = await wx.cloud.uploadFile({
        cloudPath: `batch/${Date.now()}_${uid}.jpg`,
        filePath
      });

      index = this.data.simpleItems.findIndex(i => i.uid === uid);
      if (index < 0) return;
      this.setSimpleItem(index, { fileID: up.fileID, status: 'done' });
      this.persistSimple();
    } catch (err) {
      console.error('极简模式上传失败:', err);
      index = this.data.simpleItems.findIndex(i => i.uid === uid);
      if (index < 0) return;
      this.setSimpleItem(index, { status: 'fail', error: (err && err.message) || '上传失败' });
    }
  },

  retrySimpleItem(e) {
    const uid = e.currentTarget.dataset.uid;
    const index = this.data.simpleItems.findIndex(i => i.uid === uid);
    if (index < 0) return;
    const item = this.data.simpleItems[index];
    if (item.fileID) {
      showToast('该图片已上传成功');
      return;
    }
    if (!item.path) {
      showToast('原图已失效，请重新选择图片');
      return;
    }
    this.uploadSimpleItem(uid);
  },

  removeSimpleItem(e) {
    const uid = e.currentTarget.dataset.uid;
    delete this._simplePrices[uid];
    this.setData({ simpleItems: this.data.simpleItems.filter(i => i.uid !== uid) }, () => {
      this.persistSimple();
    });
  },

  // 价格输入：只写内存、不 setData，避免输入时光标跳动
  onSimplePriceInput(e) {
    const uid = e.currentTarget.dataset.uid;
    this._simplePrices[uid] = e.detail.value;
  },

  onSimplePriceBlur() {
    // 失焦时落一次 storage，保证退出小程序后价格不丢
    this.persistSimple();
  },

  // 快捷：全部设为面议（价格留空）
  batchSetNegotiable() {
    if (!this.data.simpleItems.length) return;
    this._simplePrices = {};
    const items = this.data.simpleItems.map(it => Object.assign({}, it, { price: '' }));
    this.setData({ simpleItems: items }, () => this.persistSimple());
    showToast('已全部设为面议');
  },

  // 快捷：批量填充价格
  batchFillPrice() {
    if (!this.data.simpleItems.length) return;
    wx.showModal({
      title: '批量填充价格',
      editable: true,
      placeholderText: '输入统一价格（元）',
      success: (res) => {
        if (!res.confirm) return;
        const raw = String(res.content || '').trim();
        const amount = parseFloat(raw);
        if (!(amount > 0)) {
          showToast('请输入大于 0 的价格');
          return;
        }
        const value = String(amount);
        const items = this.data.simpleItems.map(it => {
          this._simplePrices[it.uid] = value;
          return Object.assign({}, it, { price: value });
        });
        this.setData({ simpleItems: items }, () => this.persistSimple());
        showToast(`已填充 ${items.length} 件`);
      }
    });
  },

  // 第 3 步前置：导入为待上架（draft）
  async confirmSimpleImport() {
    if (this.data.simpleBusy) return;
    const ready = this.data.simpleItems.filter(it => it.fileID);
    if (ready.length === 0) {
      showToast('请先选择图片');
      return;
    }
    if (ready.length < this.data.simpleItems.length) {
      showToast('还有图片未上传完成，请稍候或重试失败项');
      return;
    }

    const batchId = `simple_${Date.now()}`;
    const rows = ready.map((it, i) => ({
      rowNo: i + 1,
      fileName: it.fileName || '',
      title: '',                       // 留空：由服务端按 5.2 规则自动生成
      description: '',
      category: '',                    // 留空：服务端落默认分类「其他闲置」
      type: 'sell',
      price: this.priceOf(it),         // 允许为空 → 服务端落 price=0 + negotiable（面议）
      images: [it.fileID]              // 一张图 = 一件商品
    }));

    this.setData({ simpleBusy: true, simpleSummary: '' });
    showLoading('导入中...');
    const okIds = [];
    const okSet = {};
    let failList = [];
    try {
      const res = await API.batchImportRows(rows, batchId, { mode: 'simple' });
      const results = (res.data && res.data.results) || [];
      results.forEach(r => {
        // 服务端 results 按行序返回，rowNo 即 ready 中的第几件（1 起）。
        // 必须用 rowNo 反查 uid —— 若改用「okIds 的下标」反查，一旦有失败项穿插，
        // 下标就会错位：失败项被当成功移除（无法重试），成功项反而留下被重复导入。
        const idx = (r.rowNo || 0) - 1;
        if (r.ok) {
          okIds.push(r.id);
          if (ready[idx]) okSet[ready[idx].uid] = true;
        } else {
          failList.push({ rowNo: r.rowNo, error: r.error || '导入失败' });
        }
      });
    } catch (err) {
      // 请求级失败：无法判断服务端是否已写入，全部保留在原地由用户决定是否重试
      failList = rows.map(r => ({ rowNo: r.rowNo, error: err.message || '请求失败' }));
    }
    hideLoading();

    // 成功的从列表移除（已进待上架，id 留在 simpleImportedIds 供一键上架）；
    // 失败的保留在原地，可单击重试
    const remain = this.data.simpleItems.filter(it => !okSet[it.uid]);

    this.setData({
      simpleBusy: false,
      simpleItems: remain,
      simpleImportedIds: this.data.simpleImportedIds.concat(okIds),
      simpleSummary: `成功 ${okIds.length} 条，失败 ${failList.length} 条`
    }, () => this.persistSimple());

    if (failList.length === 0) {
      showToast(`已导入 ${okIds.length} 条，可在下方一键上架`);
    } else {
      wx.showModal({
        title: '导入完成',
        content: `成功 ${okIds.length} 条，失败 ${failList.length} 条。失败项已在列表中保留，可单击重试。`,
        showCancel: false
      });
    }
    this.loadDrafts();
  },

  // 第 3 步：一键全部上架
  publishSimpleAll() {
    const ids = this.data.simpleImportedIds;
    if (ids.length === 0) {
      showToast('没有待上架的信息');
      return;
    }
    wx.showModal({
      title: '全部上架',
      content: `确认将刚导入的 ${ids.length} 条信息全部上架？上架后立即出现在首页。`,
      confirmText: '全部上架',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('上架中...');
        // 服务端 publishBatch 单次上限 50 条，超出会被静默截断。
        // 这里按 50 分批发完，避免「按钮显示 60 条、实际只上架 50 条」。
        let okTotal = 0;
        let failTotal = 0;
        let firstErr = '';
        for (let i = 0; i < ids.length; i += PUBLISH_BATCH) {
          try {
            const r = await API.batchPublishBatch(ids.slice(i, i + PUBLISH_BATCH));
            const d = r.data || {};
            okTotal += d.okCount || 0;
            failTotal += d.failCount || 0;
          } catch (err) {
            failTotal += Math.min(PUBLISH_BATCH, ids.length - i);
            if (!firstErr) firstErr = err.message || '上架失败';
          }
        }
        hideLoading();
        showToast(`已上架 ${okTotal} 条${failTotal > 0 ? `，失败 ${failTotal} 条` : ''}${firstErr ? `（${firstErr}）` : ''}`);
        this.setData({ simpleImportedIds: [], simpleSummary: '' });
        try { wx.removeStorageSync(SIMPLE_STORAGE_KEY); } catch (err) { /* 忽略 */ }
        this.loadDrafts();
      }
    });
  },

  // ===================== 表格导入（高级） =====================

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

  // ===================== 手动录入（高级） =====================

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

  // 待上架页的「全部上架」：走 publishBatch，一次请求（替代原先的 N 次串行调用）
  publishAll() {
    if (!this.data.drafts.length || this.data.publishingAll) return;
    const ids = this.data.drafts.map(d => d._id);
    wx.showModal({
      title: '全部上架',
      content: `确认将当前页 ${ids.length} 条待上架信息全部上架？`,
      confirmText: '全部上架',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ publishingAll: true });
        showLoading('上架中...');
        let msg = '';
        try {
          const r = await API.batchPublishBatch(ids);
          msg = r.msg || `已上架 ${ids.length} 条`;
        } catch (err) {
          msg = err.message || '上架失败';
        }
        hideLoading();
        this.setData({ publishingAll: false });
        showToast(msg);
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

  // ===================== 授权（仅超管） =====================

  async loadAdmins() {
    this.setData({ adminLoading: true });
    try {
      const res = await API.batchListAdmins();
      const list = (res.data || []).map(x => Object.assign({}, x, {
        grantTimeText: x.grantTime ? formatDate(x.grantTime) : '',
        revokeTimeText: x.revokeTime ? formatDate(x.revokeTime) : ''
      }));
      this.setData({ adminList: list, adminLoading: false });
    } catch (err) {
      this.setData({ adminLoading: false });
      showToast(err.message || '加载授权名单失败');
    }
  },

  onGrantKeyword(e) {
    this.setData({ grantKeyword: e.detail.value });
  },

  onGrantNote(e) {
    this.setData({ grantNote: e.detail.value });
  },

  onInviteNote(e) {
    this.setData({ inviteNote: e.detail.value });
  },

  async searchGrantUsers() {
    const keyword = String(this.data.grantKeyword || '').trim();
    if (!keyword) {
      showToast('请输入昵称或姓名');
      return;
    }
    showLoading('搜索中...');
    try {
      const res = await API.batchSearchUsers(keyword);
      hideLoading();
      this.setData({ grantCandidates: res.data || [] });
      if (!res.data || res.data.length === 0) showToast('没有找到匹配的用户');
    } catch (err) {
      hideLoading();
      showToast(err.message || '搜索失败');
    }
  },

  grantTo(e) {
    const userId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '该用户';
    wx.showModal({
      title: '授权确认',
      content: `确认把「批量上架」权限授予 ${name}？对方重新进入小程序即可看到入口。`,
      confirmText: '授权',
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('授权中...');
        try {
          await API.batchGrantAdmin(userId, this.data.grantNote || '');
          hideLoading();
          // 授权后主动作废本地配置缓存，让权限立刻生效（指令 4.3）
          app.clearAppConfigCache();
          showToast('已授权');
          this.setData({ grantCandidates: [], grantKeyword: '', grantNote: '' });
          this.loadAdmins();
        } catch (err) {
          hideLoading();
          showToast(err.message || '授权失败');
        }
      }
    });
  },

  revokeAdmin(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '该用户';
    wx.showModal({
      title: '回收权限',
      content: `确认回收 ${name} 的批量上架权限？对方已导入的待上架信息仍会保留。`,
      confirmText: '回收',
      confirmColor: NATIVE_COLORS.error,
      success: async (res) => {
        if (!res.confirm) return;
        showLoading('处理中...');
        try {
          await API.batchRevokeAdmin(id);
          hideLoading();
          app.clearAppConfigCache();
          showToast('已回收权限');
          this.loadAdmins();
        } catch (err) {
          hideLoading();
          showToast(err.message || '回收失败');
        }
      }
    });
  },

  // 方式 A：生成邀请卡，通过微信转发给对方，对方点「接受」即完成授权
  async createInvite() {
    if (this.data.inviteCreating) return;
    this.setData({ inviteCreating: true });
    showLoading('生成中...');
    try {
      const res = await API.batchCreateInvite(this.data.inviteNote || '');
      hideLoading();
      this.setData({ inviteCreating: false, inviteToken: (res.data && res.data.token) || '' });
      wx.showModal({
        title: '邀请卡已生成',
        content: '点右上角「···」→「转发」，把邀请卡发给对方。5 分钟内有效，且只能被使用一次。',
        showCancel: false
      });
    } catch (err) {
      hideLoading();
      this.setData({ inviteCreating: false });
      showToast(err.message || '生成邀请卡失败');
    }
  },

  // 转发邀请卡（带一次性 token 参数）
  onShareAppMessage() {
    if (this.data.inviteToken) {
      return {
        title: '邀请你成为「云叙石光」批量上架专员',
        path: `/pages/batch_invite/batch_invite?token=${this.data.inviteToken}`
      };
    }
    return { title: '云叙石光', path: '/pages/home/home' };
  },

  goMaintenance() {
    wx.showModal({
      title: '维护模式',
      content: '在云开发控制台 config 集合的 app 记录中，把 maintenance 改为 true 即全站只读；改回 false 即恢复。详见 docs/运维手册.md 第三节。',
      showCancel: false
    });
  }
});

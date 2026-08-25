const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d0gvvc41c5a9dab3f' });
const db = cloud.database();

const MONTHLY_QUOTA = 50;

const AI_RECOGNITION_MAP = {
  'phone|手机|iphone|xiaomi|huawei|apple|samsung|oppo|vivo|荣耀|realme|红米|华为|智能手机|移动电话': { categoryId: 'c1', categoryName: '数码电子', title: '智能手机', priceMin: 300, priceMax: 2000 },
  'book|书|教材|textbook|notebook|课本|小说|参考书|辅导书|literature|reading|图书|读物|习题|试卷': { categoryId: 'c2', categoryName: '书籍教材', title: '教材/书籍', priceMin: 5, priceMax: 50 },
  'bike|自行车|单车|bicycle|骑行|山地车|公路车|脚踏车': { categoryId: 'c5', categoryName: '交通工具', title: '自行车', priceMin: 80, priceMax: 400 },
  'clothes|衣服|shirt|dress|jacket|卫衣|外套|T恤|裤子|连衣裙|hoodie|sweater|pants|上衣|衬衫|西服|羽绒服|大衣|针织|毛衣|棉服|夹克|风衣|半身裙|短裤|长裤|休闲裤|牛仔裤': { categoryId: 'c4', categoryName: '服装鞋帽', title: '衣服', priceMin: 20, priceMax: 120 },
  'shoes|鞋|sneaker|boot|运动鞋|皮鞋|跑鞋|高跟鞋|footwear|帆布鞋|板鞋|拖鞋|凉鞋|靴子|登山鞋|篮球鞋': { categoryId: 'c4', categoryName: '服装鞋帽', title: '鞋子', priceMin: 30, priceMax: 200 },
  'cosmetic|化妆品|makeup|lipstick|口红|护肤品|面霜|乳液|精华|skincare|粉底|面膜|香水|眼影|眉笔|腮红|卸妆|防晒': { categoryId: 'c7', categoryName: '美妆护肤', title: '化妆品', priceMin: 20, priceMax: 150 },
  'basketball|篮球|football|足球|volleyball|排球|badminton|羽毛球|pingpong|乒乓球|tennis|网球|baseball|棒球|垒球': { categoryId: 'c6', categoryName: '体育器材', title: '球类用品', priceMin: 20, priceMax: 120 },
  'yoga|瑜伽|健身|哑铃|拉力器|护具|运动装备|跳绳|俯卧撑|单杠|健身器材': { categoryId: 'c6', categoryName: '体育器材', title: '健身器材', priceMin: 30, priceMax: 200 },
  'instrument|乐器|吉他|钢琴|尤克里里|小提琴|guitar|piano|古筝|笛子|萨克斯|架子鼓|电子琴|口琴|葫芦丝': { categoryId: 'c6', categoryName: '体育器材', title: '乐器', priceMin: 100, priceMax: 800 },
  'laptop|电脑|macbook|notebook|笔记本|thinkpad|surface|游戏本|computer|pc|笔记本电脑|超级本|上网本': { categoryId: 'c1', categoryName: '数码电子', title: '笔记本电脑', priceMin: 800, priceMax: 5000 },
  'tablet|平板|ipad|pad|tab|平板电脑': { categoryId: 'c1', categoryName: '数码电子', title: '平板电脑', priceMin: 500, priceMax: 2500 },
  'headphone|耳机|airpod|earphone|音响|音箱|beats|sony|speaker|蓝牙耳机|头戴式|入耳式|降噪耳机': { categoryId: 'c1', categoryName: '数码电子', title: '耳机/音响', priceMin: 50, priceMax: 500 },
  'watch|手表|手环|smartwatch|机械表|石英表|智能手表|运动手环|腕表|电子表': { categoryId: 'c1', categoryName: '数码电子', title: '智能手表', priceMin: 100, priceMax: 800 },
  'camera|相机|单反|拍立得|微单|摄像机|gopro|数码相机|镜头|闪光灯|三脚架': { categoryId: 'c1', categoryName: '数码电子', title: '相机', priceMin: 500, priceMax: 3000 },
  'keyboard|键盘|鼠标|外设|机械键盘|显示器|monitor|mouse|键鼠|webcam|摄像头|麦克风|话筒': { categoryId: 'c1', categoryName: '数码电子', title: '键盘鼠标', priceMin: 50, priceMax: 400 },
  'bag|包|书包|背包|手提包|双肩包|钱包|handbag|backpack|单肩包|斜挎包|帆布包|箱包|旅行包|电脑包|购物袋|腰包|胸包|拉杆箱|行李箱|登机箱': { categoryId: 'c4', categoryName: '服装鞋帽', title: '背包/包袋', priceMin: 30, priceMax: 200 },
  'desk|桌子|椅子|家具|收纳|衣柜|书架|furniture|chair|书桌|餐桌|电脑桌|办公椅|凳子|沙发|床|床头柜|鞋柜|茶几|置物架|收纳箱|收纳盒': { categoryId: 'c8', categoryName: '生活家居', title: '家具', priceMin: 40, priceMax: 300 },
  'cup|杯子|水壶|水瓶|保温杯|水杯|bottle|mug|马克杯|玻璃杯|陶瓷杯|随手杯|茶杯|咖啡杯': { categoryId: 'c8', categoryName: '生活家居', title: '水杯', priceMin: 10, priceMax: 60 },
  'lamp|灯|台灯|照明|护眼灯|吊灯|light|LED灯|落地灯|床头灯|夜灯|补光灯|小夜灯': { categoryId: 'c8', categoryName: '生活家居', title: '台灯', priceMin: 20, priceMax: 120 },
  'fan|风扇|空调|制冷|电扇|aircon|排气扇|加湿器|除湿机|暖风机|空气净化器': { categoryId: 'c8', categoryName: '生活家居', title: '风扇/电器', priceMin: 30, priceMax: 200 },
  'plant|植物|多肉|盆栽|绿植|succulent|花盆|花卉|干花|仿真花|花瓶': { categoryId: 'c8', categoryName: '生活家居', title: '绿植盆栽', priceMin: 10, priceMax: 80 },
  'toy|玩具|玩偶|公仔|乐高|积木|拼图|toy|lego|手办|模型|毛绒玩具|益智玩具|桌游|棋类': { categoryId: 'c9', categoryName: '其他闲置', title: '玩具', priceMin: 10, priceMax: 150 },
  'printer|打印机|扫描仪|投影仪|投影|printer|projector|复印机|碎纸机|一体机': { categoryId: 'c1', categoryName: '数码电子', title: '打印机/投影仪', priceMin: 80, priceMax: 500 },
  'bicycle|电动车|电瓶车|滑板车|ebike|scooter|平衡车|电动滑板|独轮车': { categoryId: 'c5', categoryName: '交通工具', title: '电动车/滑板车', priceMin: 300, priceMax: 1500 },
  'food|食品|零食|饮料|茶叶|咖啡|snack|food|drink|坚果|饼干|巧克力|糖果|冲调|奶粉': { categoryId: 'c9', categoryName: '其他闲置', title: '食品/饮料', priceMin: 10, priceMax: 80 },
  'charger|充电器|充电线|数据线|充电宝|power bank|转接头|扩展坞|支架|手机壳|贴膜|保护套': { categoryId: 'c1', categoryName: '数码电子', title: '充电器/配件', priceMin: 10, priceMax: 100 },
  'accessory|配饰|耳环|项链|手链|戒指|jewelry|发饰|胸针|眼镜|墨镜|太阳镜|围巾|手套|帽子|皮带|领带': { categoryId: 'c4', categoryName: '服装鞋帽', title: '配饰首饰', priceMin: 15, priceMax: 100 },
  'stationery|文具|笔|本子|笔记本|记事本|pen|notebook|计算器|尺子|橡皮|胶带|文件夹|便签|手帐|胶棒|剪刀': { categoryId: 'c9', categoryName: '其他闲置', title: '文具用品', priceMin: 5, priceMax: 40 },
  'default': { categoryId: 'c9', categoryName: '其他闲置', title: '闲置物品', priceMin: 10, priceMax: 100 }
};

const CATEGORY_KEYWORDS = {
  '数码电子': ['手机', '电脑', '笔记本', '平板', '相机', '耳机', '手表', '键盘', '鼠标', '显示器', '打印机', '投影仪', '充电', '电池', 'U盾', '移动电源', '手机壳', '数据线', '充电器', '充电宝', '智能', '蓝牙', '音响', '音箱', '麦克风', '摄像头', '扩展坞', '转接头'],
  '书籍教材': ['书', '教材', '课本', '小说', '笔记', '辅导', '参考书', '习题集', '名著', '文献', '读物', '试卷', '图书'],
  '交通工具': ['自行', '电动车', '滑板', '单车', '山地', '公路车', '电瓶车', '平衡车', '脚踏车'],
  '服装鞋帽': ['衣服', '鞋', '裤', 'T恤', '裙', '外套', '卫衣', '帽', '袜', '手套', '羽绒服', '大衣', '衬衫', '西装', '包', '背包', '书包', '双肩包', '单肩包', '钱包', '手提包', '箱包', '行李箱', '围巾', '皮带', '领带', '帆布', '牛仔裤', '休闲裤', '连衣裙', '夹克', '风衣', '棉服'],
  '美妆护肤': ['化妆', '口红', '粉底', '面膜', '护肤', '面霜', '香水', '眉笔', '睫毛', '眼影', '腮红', '卸妆', '防晒', '乳液', '精华'],
  '体育器材': ['球', '拍', '瑜伽', '健身', '哑铃', '自行车', '乐器', '滑板', '轮滑', '跑步机', '吉他', '钢琴', '小提琴', '古筝', '笛子', '护具', '拉力器', '篮球', '足球', '排球', '羽毛球', '乒乓球', '网球', '棒球', '跳绳', '单杠', '俯卧撑'],
  '生活家居': ['杯', '碗', '锅', '灯', '风扇', '家具', '收纳', '拖把', '扫帚', '地毯', '沙发', '床垫', '枕头', '被子', '桌子', '椅子', '书桌', '花瓶', '盆栽', '绿植', '加湿器', '净化器', '暖风机', '台灯', '水壶', '保温杯'],
  '其他闲置': ['玩具', '零食', '食品', '茶叶', '咖啡', 'DIY', '文具', '配饰', '首饰', '手办', '模型', '乐高', '积木', '桌游', '笔', '本子', '计算器', '文件夹', '便签', '饼干', '巧克力', '糖果']
};

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function ensureUserDocument(openid) {
  const userRes = await db.collection('user').where({ _openid: openid }).get();
  if (userRes.data.length === 0) {
    const newUser = {
      _openid: openid,
      nickname: '',
      avatarUrl: '',
      auctionMonth: getCurrentMonth(),
      auctionCount: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    await db.collection('user').add({ data: newUser });
    return newUser;
  }
  return userRes.data[0];
}

async function checkQuota(openid) {
  const user = await ensureUserDocument(openid);

  const currentMonth = getCurrentMonth();
  const storedMonth = user.auctionMonth || '';
  const used = user.auctionCount || 0;

  if (storedMonth !== currentMonth) {
    await db.collection('user').where({ _openid: openid }).update({
      data: {
        auctionCount: 0,
        auctionMonth: currentMonth,
        updateTime: db.serverDate()
      }
    });
    return { code: 0, data: { remaining: MONTHLY_QUOTA, total: MONTHLY_QUOTA, month: currentMonth, used: 0 } };
  }

  return { code: 0, data: { remaining: Math.max(0, MONTHLY_QUOTA - used), total: MONTHLY_QUOTA, month: currentMonth, used } };
}

async function consumeQuota(openid) {
  const user = await ensureUserDocument(openid);
  const currentMonth = getCurrentMonth();
  const storedMonth = user.auctionMonth || '';
  const used = user.auctionCount || 0;

  if (storedMonth !== currentMonth) {
    const newCount = 1;
    await db.collection('user').where({ _openid: openid }).update({
      data: {
        auctionCount: newCount,
        auctionMonth: currentMonth,
        updateTime: db.serverDate()
      }
    });
    return { code: 0, data: { remaining: MONTHLY_QUOTA - newCount, total: MONTHLY_QUOTA, month: currentMonth, used: newCount } };
  }

  if (used >= MONTHLY_QUOTA) {
    return { code: -1, msg: '本月免费额度已用完' };
  }

  const newCount = used + 1;
  await db.collection('user').where({ _openid: openid }).update({
    data: {
      auctionCount: newCount,
      updateTime: db.serverDate()
    }
  });

  return { code: 0, data: { remaining: MONTHLY_QUOTA - newCount, total: MONTHLY_QUOTA, month: currentMonth, used: newCount } };
}

function matchCategoryFromKeywords(keywords) {
  if (!keywords || keywords.length === 0) return null;

  let bestCategory = null;
  let bestScore = 0;

  for (const [categoryName, categoryKeywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const kw = keyword.toLowerCase().trim();
      if (!kw) continue;
      for (const catKw of categoryKeywords) {
        const catKwLower = catKw.toLowerCase();
        if (kw === catKwLower) {
          score += 3;
        } else if (kw.includes(catKwLower) || catKwLower.includes(kw)) {
          score += 1.5;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = categoryName;
    }
  }

  return bestScore > 0 ? bestCategory : null;
}

function matchFromResult(classifyKeywords, ocrTexts) {
  const allTexts = [];
  if (Array.isArray(classifyKeywords)) {
    allTexts.push(...classifyKeywords.filter(Boolean));
  } else if (classifyKeywords) {
    allTexts.push(classifyKeywords);
  }
  if (ocrTexts && ocrTexts.length > 0) {
    allTexts.push(...ocrTexts);
  }

  const combinedText = allTexts.join(' ').toLowerCase();

  let matched = { ...AI_RECOGNITION_MAP['default'] };
  let bestMatchScore = 0;
  let bestMatchedPattern = '';

  for (const [key, value] of Object.entries(AI_RECOGNITION_MAP)) {
    if (key === 'default') continue;
    const patterns = key.split('|');
    let matchScore = 0;

    for (const pattern of patterns) {
      const p = pattern.toLowerCase().trim();
      if (!p) continue;
      
      for (const text of allTexts) {
        const textLower = text.toLowerCase();
        if (textLower === p) {
          matchScore += 5;
          if (p.length > bestMatchedPattern.length) {
            bestMatchedPattern = pattern;
          }
        } else if (textLower.includes(p) || p.includes(textLower)) {
          matchScore += 2;
          if (p.length > bestMatchedPattern.length && textLower.includes(p)) {
            bestMatchedPattern = pattern;
          }
        }
      }
      
      if (combinedText.includes(p)) {
        matchScore += 1;
      }
    }

    if (matchScore > bestMatchScore) {
      bestMatchScore = matchScore;
      matched = { ...value };
    }
  }

  if (bestMatchScore === 0) {
    const allKeywords = [...(Array.isArray(classifyKeywords) ? classifyKeywords : [classifyKeywords].filter(Boolean)), ...(ocrTexts || [])];
    const categoryFromOCR = matchCategoryFromKeywords(allKeywords);
    if (categoryFromOCR) {
      for (const [key, value] of Object.entries(AI_RECOGNITION_MAP)) {
        if (key === 'default') continue;
        if (value.categoryName === categoryFromOCR) {
          matched = { ...value };
          break;
        }
      }
    }
  }

  return { matched, bestMatchScore, bestMatchedPattern };
}

// 使用 Node 原生 https 模块发起请求，不依赖 axios
const https = require('https');
const http = require('http');
const { URL } = require('url');

// 百度API token缓存
let _cachedToken = null;
let _cachedTokenExpire = 0;
const TOKEN_REFRESH_MARGIN = 3600;

function httpsRequest(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }, options.headers || {}),
      timeout: options.timeout || 15000
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function getBaiduToken() {
  const now = Date.now() / 1000;
  if (_cachedToken && now < _cachedTokenExpire) {
    return _cachedToken;
  }

  try {
    const tokenUrl = 'https://aip.baidubce.com/oauth/2.0/token' +
      '?grant_type=client_credentials' +
      '&client_id=0CvSuh75zm2R4eNhWzbkPxTY' +
      '&client_secret=Hq3ZM4oyyiAEVqXmKdmQMuKy66aNuMTv';

    const res = await httpsRequest(tokenUrl, { method: 'GET', timeout: 8000 });

    if (res.data && res.data.access_token) {
      _cachedToken = res.data.access_token;
      _cachedTokenExpire = now + (res.data.expires_in || 2592000) - TOKEN_REFRESH_MARGIN;
      console.log('[百度API] Token获取成功, 有效期至:', new Date(_cachedTokenExpire * 1000).toISOString());
      return _cachedToken;
    }

    console.error('[百度API] Token获取失败, 响应:', JSON.stringify(res.data));
    throw new Error('获取百度API token失败');
  } catch (err) {
    console.error('[百度API] Token请求异常:', err.message);
    throw err;
  }
}

async function callBaiduAPI(endpoint, params) {
  const accessToken = await getBaiduToken();
  const url = `https://aip.baidubce.com${endpoint}?access_token=${encodeURIComponent(accessToken)}`;
  const postData = params;

  const res = await httpsRequest(url, {
    method: 'POST',
    timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, postData);

  if (res.data && res.data.error_code) {
    console.warn('[百度API] 接口错误:', endpoint, 'code:', res.data.error_code, 'msg:', res.data.error_msg);
  } else {
    const resultCount = res.data && res.data.result ? res.data.result.length : 0;
    const wordCount = res.data && res.data.words_result ? res.data.words_result.length : 0;
    console.log('[百度API] 调用成功:', endpoint, '结果数:', resultCount || wordCount);
  }

  return res.data;
}

async function downloadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('base64'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('图片下载超时')); });
    req.end();
  });
}

async function realAIRecognize(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) {
    throw new Error('请先上传商品图片');
  }

  console.log('[AI识别] 开始, 图片数量:', imageUrls.length, '首张:', imageUrls[0]);

  let base64Image = '';
  let downloadMethod = '';

  // 方案1: 使用 cloud.downloadFile 直接下载为 buffer
  try {
    console.log('[AI识别] 尝试 downloadFile...');
    const downloadRes = await cloud.downloadFile({ fileID: imageUrls[0] });
    base64Image = downloadRes.fileContent.toString('base64');
    downloadMethod = 'downloadFile';
    console.log('[AI识别] downloadFile成功, base64长度:', base64Image.length);
  } catch (dlErr) {
    console.warn('[AI识别] downloadFile失败:', dlErr.message);

    // 方案2: getTempFileURL + https 下载
    try {
      console.log('[AI识别] 回退到 getTempFileURL + https...');
      const tempUrlRes = await cloud.getTempFileURL({
        fileList: imageUrls.slice(0, 3)
      });

      const tempUrls = tempUrlRes.fileList
        .filter(f => f.status === 0 && f.tempFileURL)
        .map(f => f.tempFileURL);

      console.log('[AI识别] getTempFileURL结果:', tempUrls.length, '个可用链接');

      if (tempUrls.length === 0) {
        throw new Error('图片链接已过期或不存在，请重新上传图片');
      }

      base64Image = await downloadImageAsBase64(tempUrls[0]);
      downloadMethod = 'getTempFileURL+https';
      console.log('[AI识别] https下载成功, base64长度:', base64Image.length);
    } catch (dl2Err) {
      console.error('[AI识别] 所有图片下载方式均失败:', dl2Err.message);
      throw new Error('图片加载失败，请重新选择图片');
    }
  }

  // 百度API base64 图片上限约 4MB，超限会直接报错
  if (base64Image.length > 4 * 1024 * 1024) {
    console.warn('[AI识别] 图片过大, base64长度:', base64Image.length);
    throw new Error('图片过大（超过3MB），请使用更小的图片');
  }

  if (base64Image.length < 1000) {
    console.warn('[AI识别] 图片base64异常小:', base64Image.length);
    throw new Error('图片内容异常，请重新选择');
  }

  console.log('[AI识别] 图片准备完成, 方式:', downloadMethod, 'base64长度:', base64Image.length);

  let classifyResults = [];
  let ocrResults = [];
  let apiErrors = [];

  // 并行调用产品识别 + OCR，提升速度
  const encodedImage = encodeURIComponent(base64Image);
  console.log('[AI识别] 并行调用产品识别 + OCR...');

  const [productData, ocrData] = await Promise.all([
    callBaiduAPI('/rest/2.0/image-classify/v1/product', `image=${encodedImage}&top_num=5`)
      .catch(e => { console.error('[AI识别] 产品识别调用异常:', e.message); apiErrors.push('product:' + e.message); return null; }),
    callBaiduAPI('/rest/2.0/ocr/v1/general_basic', `image=${encodedImage}`)
      .catch(e => { console.error('[AI识别] OCR调用异常:', e.message); apiErrors.push('ocr:' + e.message); return null; })
  ]);

  console.log('[AI识别] 产品识别结果:', productData ? (productData.result ? productData.result.length + '条结果' : '无result') : 'null');
  console.log('[AI识别] OCR结果:', ocrData ? (ocrData.words_result ? ocrData.words_result.length + '条文字' : '无words_result') : 'null');

  if (productData && productData.result && productData.result.length > 0) {
    classifyResults = productData.result;
  }

  // 产品识别无结果时，依次回退到通用识别、多主体识别
  if (classifyResults.length === 0) {
    console.log('[AI识别] 产品识别无结果，回退到通用识别...');
    try {
      const generalData = await callBaiduAPI(
        '/rest/2.0/image-classify/v1/general',
        `image=${encodedImage}&top_num=5`
      );
      if (generalData && generalData.result && generalData.result.length > 0) {
        classifyResults = generalData.result;
        console.log('[AI识别] 通用识别成功:', classifyResults.length, '条结果');
      }
    } catch (err2) {
      console.error('[AI识别] 通用识别异常:', err2.message);
      apiErrors.push('general:' + err2.message);
    }
  }

  if (classifyResults.length === 0) {
    console.log('[AI识别] 通用识别无结果，回退到多主体识别...');
    try {
      const advancedData = await callBaiduAPI(
        '/rest/2.0/image-classify/v2/advanced_general',
        `image=${encodedImage}&top_num=5`
      );
      if (advancedData && advancedData.result && advancedData.result.length > 0) {
        classifyResults = advancedData.result;
        console.log('[AI识别] 多主体识别成功:', classifyResults.length, '条结果');
      }
    } catch (err3) {
      console.error('[AI识别] 多主体识别异常:', err3.message);
      apiErrors.push('advanced:' + err3.message);
    }
  }

  if (ocrData && ocrData.words_result) {
    ocrResults = ocrData.words_result.map(w => w.words);
  }

  console.log('[AI识别] 最终结果: classifyResults=' + classifyResults.length + ', ocrResults=' + ocrResults.length + ', apiErrors=' + apiErrors.length);

  // 所有识别 API 均无结果时，抛出异常，不消耗用户次数
  if (classifyResults.length === 0 && ocrResults.length === 0) {
    const errMsg = apiErrors.length > 0
      ? '识别服务暂时不可用，请稍后重试'
      : 'AI未能识别出商品信息，请更换更清晰的照片';
    console.error('[AI识别] 所有API均无结果, errors:', apiErrors.join('; '));
    throw new Error(errMsg);
  }

  const classifyKeywords = classifyResults.map(r => r.keyword).filter(Boolean);
  const maxClassifyScore = classifyResults.length > 0 
    ? Math.max(...classifyResults.map(r => r.score || 0)) 
    : 0;

  const { matched, bestMatchScore, bestMatchedPattern } = matchFromResult(classifyKeywords, ocrResults);

  // === 数量识别：综合产品识别位置信息 + OCR数量词 ===
  let detectedQuantity = 1;
  let quantitySource = 'default';

  // 方式1：统计产品识别结果中相同keyword但不同location的项
  if (classifyResults.length > 0) {
    const locationGroups = {};
    for (const r of classifyResults) {
      if (!r.keyword) continue;
      const kw = r.keyword.toLowerCase().trim();
      if (!locationGroups[kw]) locationGroups[kw] = [];
      // 如果有location信息，记录位置（不同位置 = 不同物体）
      if (r.location) {
        locationGroups[kw].push({
          top: r.location.top || 0,
          left: r.location.left || 0,
          width: r.location.width || 0,
          height: r.location.height || 0
        });
      } else {
        locationGroups[kw].push({});
      }
    }
    // 找出位置不同但keyword相同的最大组
    for (const [kw, locs] of Object.entries(locationGroups)) {
      if (locs.length <= 1) continue;
      // 过滤掉位置几乎完全重叠的（同一个物体的多次匹配）
      const uniqueLocs = [];
      for (const loc of locs) {
        if (!loc.top && !loc.left) continue;
        const isDuplicate = uniqueLocs.some(ul => {
          const dx = Math.abs(ul.left - loc.left);
          const dy = Math.abs(ul.top - loc.top);
          return dx < 30 && dy < 30; // 30px内视为同一位置
        });
        if (!isDuplicate) uniqueLocs.push(loc);
      }
      if (uniqueLocs.length > detectedQuantity) {
        detectedQuantity = uniqueLocs.length;
        quantitySource = 'product_location';
        console.log('[AI识别-数量] keyword=' + kw + ' 检测到 ' + detectedQuantity + ' 个不同位置');
      }
    }
  }

  // 方式2：从OCR文本中提取数量词（如"3本"、"2双"、"×5"、"套装5件"等）
  if (detectedQuantity === 1 && ocrResults.length > 0) {
    const ocrText = ocrResults.join(' ');
    // 匹配中文数量表达
    const numPatterns = [
      /(\d+)\s*[本册本件双套条个只包盒]/g,   // 3本、2双、5件
      /[×x]\s*(\d+)/g,                        // ×5
      /(\d+)\s*[×x]/g,                        // 5×
      /套装\s*(\d+)\s*件/,                     // 套装5件
      /共?\s*(\d+)\s*[个只本件双包盒册]/g,     // 共3本
    ];
    for (const pattern of numPatterns) {
      const matches = [...ocrText.matchAll(pattern)];
      if (matches.length > 0) {
        const num = parseInt(matches[0][1]);
        if (num >= 2 && num <= 99) {
          detectedQuantity = num;
          quantitySource = 'ocr_text';
          console.log('[AI识别-数量] OCR提取数量: ' + num + ' (来源: ' + matches[0][0] + ')');
          break;
        }
      }
    }
  }

  // 方式3：通用识别结果中多个不同keyword指向同类商品时，也考虑数量
  if (detectedQuantity === 1 && classifyResults.length >= 3) {
    // 如果返回了3个以上结果且都指向同一类商品，可能图片中有多个
    const categoryGroups = {};
    for (const r of classifyResults) {
      if (!r.keyword) continue;
      // 用matchFromResult找到该keyword对应的分类
      const { matched: m } = matchFromResult([r.keyword], []);
      const cat = m.categoryName;
      if (!categoryGroups[cat]) categoryGroups[cat] = [];
      categoryGroups[cat].push(r.keyword);
    }
    for (const [cat, kws] of Object.entries(categoryGroups)) {
      // 同分类下有3个以上不同keyword（排除default分类）
      if (cat !== '其他闲置' && kws.length >= 3) {
        // 可能是多个同类商品的不同角度识别
        detectedQuantity = Math.min(kws.length, 5); // 上限5个
        quantitySource = 'classify_cluster';
        console.log('[AI识别-数量] 同分类"' + cat + '"下 ' + kws.length + ' 个不同keyword: ' + kws.join(','));
        break;
      }
    }
  }

  console.log('[AI识别-数量] 最终数量: ' + detectedQuantity + ' (来源: ' + quantitySource + ')');

  // === 置信度计算 ===
  let confidence = 30;
  if (classifyResults.length > 0 && maxClassifyScore > 0) {
    confidence = Math.floor(maxClassifyScore * 100);
  }
  if (bestMatchScore > 0) {
    confidence = Math.min(98, confidence + Math.floor(bestMatchScore * 3));
  }
  if (ocrResults.length > 0 && confidence < 60) {
    confidence = Math.min(90, confidence + 15);
  }
  if (confidence === 30 && classifyResults.length === 0 && ocrResults.length === 0) {
    confidence = 30;
  } else if (confidence < 40) {
    confidence = 45;
  }

  // === 标题：优先使用百度返回的具体关键词 ===
  let specificTitle = matched.title;
  // 百度产品识别返回的keyword通常更具体（如"篮球""羽毛球拍"）
  if (classifyKeywords.length > 0) {
    const topKeyword = classifyKeywords[0];
    // 如果返回的关键词比预设title更具体，使用关键词
    if (topKeyword && topKeyword.length >= 2 && topKeyword.length <= 10) {
      specificTitle = topKeyword;
    }
  }
  // 如果OCR识别到品牌名等信息，拼接到标题
  const brandFromOCR = ocrResults.find(t => t && t.length >= 2 && t.length <= 8 && /[\u4e00-\u9fa5a-zA-Z]/.test(t));
  if (brandFromOCR && brandFromOCR !== specificTitle && !specificTitle.includes(brandFromOCR)) {
    specificTitle = `${brandFromOCR} ${specificTitle}`;
  }

  // === 成色判断：基于置信度，不使用随机 ===
  // 置信度高→AI识别清晰→商品状态可能较好；置信度低→图片模糊→保守估计
  let condition;
  if (confidence >= 85) {
    condition = '99新';
  } else if (confidence >= 65) {
    condition = '9成新';
  } else if (confidence >= 45) {
    condition = '8成新';
  } else {
    condition = '7成新及以下';
  }

  // === 推荐价格：基于价格区间 + 成色系数 + 置信度微调 + 数量 ===
  const conditionFactor = {
    '99新': 0.85,
    '9成新': 0.65,
    '8成新': 0.45,
    '7成新及以下': 0.30
  };
  const basePrice = matched.priceMin + (matched.priceMax - matched.priceMin) * (conditionFactor[condition] || 0.5);
  // 置信度微调：高置信度→价格偏中高位，低置信度→偏中低位
  const confidenceAdjust = (confidence - 50) / 200; // -0.1 ~ +0.24
  const unitPrice = Math.max(matched.priceMin, Math.round(basePrice * (1 + confidenceAdjust) / 10) * 10);
  // 数量影响：多件商品总价 = 单价 × 数量 × 批量折扣系数（数量越多折扣越大）
  let quantityDiscount = 1.0;
  if (detectedQuantity >= 5) {
    quantityDiscount = 0.85; // 5件以上85折
  } else if (detectedQuantity >= 3) {
    quantityDiscount = 0.9;  // 3-4件9折
  } else if (detectedQuantity === 2) {
    quantityDiscount = 0.95; // 2件95折
  }
  const finalPrice = Math.round(unitPrice * detectedQuantity * quantityDiscount / 10) * 10;

  // === 商品描述：根据分类和成色生成详细描述 ===
  const descTemplates = {
    '数码电子': [
      `${specificTitle}，${condition}，功能正常无暗病，外观保护良好无明显划痕。配件齐全，即插即用，校内面交可验货。`,
      `出${specificTitle}，${condition}，使用时间不长，电池续航正常，无维修记录。包装配件都在，性价比之选。`,
      `闲置${specificTitle}转让，${condition}，功能完好测试一切正常。毕业清仓，价格可小刀，校内当面交易。`
    ],
    '书籍教材': [
      `${specificTitle}，${condition}，内页干净无涂改，笔记极少，适合备考复习。包邮校内面交均可。`,
      `出${specificTitle}，${condition}，内容完整无缺页，封面轻微使用痕迹。考研/期末复习利器，到手即用。`,
      `闲置${specificTitle}，${condition}，书页整洁无破损，重点已标注。知识不闲置，低价转给需要的同学。`
    ],
    '交通工具': [
      `${specificTitle}，${condition}，骑行顺畅无异响，刹车轮胎状态良好。校内自提，支持试骑。`,
      `出${specificTitle}，${condition}，车架无变形无锈蚀，变速/刹车正常。毕业转让，性价比高。`,
      `闲置${specificTitle}转让，${condition}，日常通勤利器，保养得当。校内面交，价格可谈。`
    ],
    '服装鞋帽': [
      `${specificTitle}，${condition}，无破损无褪色，尺码合适穿着舒适。清洗已处理好，到手即穿。`,
      `出${specificTitle}，${condition}，面料质感好，版型正。闲置太久没穿过，低价出给有缘人。`,
      `闲置${specificTitle}，${condition}，实物如图颜色正，无异味无污渍。校内面交可试穿。`
    ],
    '美妆护肤': [
      `${specificTitle}，${condition}，正品保证余量充足，无过敏成分。适合对应肤质，校内面交可验真。`,
      `出${specificTitle}，${condition}，用量不多保存妥当，未开封/已开封状态如图。闲置转出，价格美丽。`,
      `闲置${specificTitle}转让，${condition}，保质期内无变质。正品购入有凭证，放心使用。`
    ],
    '体育器材': [
      `${specificTitle}，${condition}，弹力/抓地力正常，无开胶无变形。运动健身好搭档，校内面交。`,
      `出${specificTitle}，${condition}，使用痕迹轻微，性能不受影响。适合日常运动训练，性价比高。`,
      `闲置${specificTitle}转让，${condition}，实物如图完好可用。毕业清仓，校内自提价格可议。`
    ],
    '生活家居': [
      `${specificTitle}，${condition}，功能正常无损坏，外观整洁易清洁。宿舍收纳实用好物，校内面交。`,
      `出${specificTitle}，${condition}，使用时间短成色好，无异味无破损。搬家清出，低价转手。`,
      `闲置${specificTitle}，${condition}，实物如图，结实耐用。提升宿舍生活品质，价格可小刀。`
    ],
    '其他闲置': [
      `${specificTitle}，${condition}，完好无缺功能正常，实物如图。闲置转出，校内面交。`,
      `出${specificTitle}，${condition}，保存得当无损坏。兴趣不再低价出，有缘者联系。`,
      `闲置${specificTitle}转让，${condition}，成色如图所示。毕业清仓，欢迎咨询。`
    ]
  };

  const descList = descTemplates[matched.categoryName] || descTemplates['其他闲置'];
  const description = descList[Math.floor(Math.random() * descList.length)];

  const matchedCategory = matchCategoryFromKeywords(
    [...classifyKeywords, ...ocrResults]
  );

  if (matchedCategory && matchedCategory !== matched.categoryName) {
    matched.categoryName = matchedCategory;
    const catItem = Object.values(AI_RECOGNITION_MAP).find(v => v.categoryName === matchedCategory);
    if (catItem) {
      matched.categoryId = catItem.categoryId;
    }
  }

  console.log('[AI识别] 最终结果: title=' + specificTitle + ', condition=' + condition + ', price=' + finalPrice + ', confidence=' + confidence + ', quantity=' + detectedQuantity);

  const quantityLabel = detectedQuantity > 1 ? `（${detectedQuantity}件）` : '';

  return {
    ...matched,
    price: String(finalPrice),
    unitPrice: String(unitPrice),
    quantity: detectedQuantity,
    title: `${specificTitle}${quantityLabel} - 校内转让`,
    description,
    tradeLocation: '一食堂门口',
    confidence,
    images: imageUrls
  };
}

exports.main = async (event, context) => {
  const { action, images } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, msg: '用户未授权' };
  }

  if (action === 'getQuota') {
    return checkQuota(openid);
  }

  if (action === 'recognize') {
    const quotaCheck = await checkQuota(openid);
    if (quotaCheck.code !== 0 || (quotaCheck.data && quotaCheck.data.remaining <= 0)) {
      return { code: -1, msg: '本月免费额度已用完' };
    }

    let aiResult;
    try {
      aiResult = await realAIRecognize(images);
    } catch (aiErr) {
      console.error('[AI识别] 失败:', aiErr.message);
      // 将具体错误信息传递给前端，而不是笼统的"服务异常"
      const errMsg = aiErr.message || 'AI识别服务异常，请稍后重试';
      return { code: -1, msg: errMsg };
    }

    const quotaRes = await consumeQuota(openid);
    if (quotaRes.code !== 0) {
      return {
        code: 0,
        data: {
          ...aiResult,
          remainingQuota: 0
        },
        msg: '识别成功'
      };
    }

    try {
      await db.collection('auction_record').add({
        data: {
          _openid: openid,
          images: images || [],
          result: aiResult,
          createTime: db.serverDate()
        }
      });
    } catch (logErr) {
      console.error('记录识别历史失败:', logErr);
    }

    return {
      code: 0,
      data: {
        ...aiResult,
        remainingQuota: quotaRes.data.remaining
      },
      msg: '识别成功'
    };
  }

  return { code: -1, msg: '未知操作' };
};

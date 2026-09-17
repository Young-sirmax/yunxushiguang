// tests/bookcorner.local.test.js —— bookcorner 云函数本地冒烟测试（不连云开发）
//
// 原理：用 module._load 钩子把 wx-server-sdk 换成一个内存版假数据库，
//       直接 require 云函数源码并调用 exports.main，验证业务逻辑。
// 运行：node tests/bookcorner.local.test.js
const path = require('path');
const Module = require('module');

// ===================== 内存版 wx-server-sdk =====================
const store = {
  config: [],
  user: [],
  space: [],
  book: [],
  book_comment: [],
  exchange_log: []
};

let currentOpenid = 'openid_test';
let nextId = 1;

function matches(doc, where) {
  return Object.keys(where).every(key => {
    const cond = where[key];
    const value = doc[key];
    if (cond && typeof cond === 'object' && cond.__op) {
      if (cond.__op === 'gt') return new Date(value).getTime() > new Date(cond.value).getTime();
      return true;
    }
    return value === cond;
  });
}

function makeQuery(name, where, state) {
  const st = Object.assign({ skip: 0, limit: 20, order: [], fields: null }, state);
  const q = {
    where(nextWhere) { return makeQuery(name, nextWhere, st); },
    orderBy(field, dir) { st.order = st.order.concat([[field, dir]]); return q; },
    field(spec) { st.fields = spec; return q; },
    skip(n) { st.skip = n; return q; },
    limit(n) { st.limit = n; return q; },
    async get() {
      let rows = store[name].filter(doc => matches(doc, where));
      st.order.forEach(([field, dir]) => {
        rows = rows.slice().sort((a, b) => {
          const av = a[field] instanceof Date ? a[field].getTime() : a[field];
          const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return dir === 'desc' ? -cmp : cmp;
        });
      });
      let page = rows.slice(st.skip, st.skip + st.limit).map(doc => Object.assign({}, doc));
      // 模拟云数据库的字段投影（field 只保留为 true 的字段，_id 默认保留）
      if (st.fields) {
        const keys = Object.keys(st.fields).filter(k => st.fields[k]);
        page = page.map(doc => {
          const out = {};
          keys.forEach(k => { if (doc[k] !== undefined) out[k] = doc[k]; });
          if (out._id === undefined && doc._id !== undefined && st.fields._id !== false) out._id = doc._id;
          return out;
        });
      }
      return { data: page };
    },
    async count() {
      return { total: store[name].filter(doc => matches(doc, where)).length };
    },
    async add({ data }) {
      const _id = name + '_' + (nextId++);
      const doc = Object.assign({ _id }, data);
      Object.keys(doc).forEach(k => { if (doc[k] === '__SERVER_DATE__') doc[k] = new Date(); });
      store[name].push(doc);
      return { _id };
    },
    async update({ data }) {
      store[name] = store[name].map(doc => (matches(doc, where) ? Object.assign(doc, data) : doc));
      return { stats: { updated: 1 } };
    },
    doc(id) {
      return {
        async get() { return { data: store[name].find(d => d._id === id) || null }; },
        async update({ data }) {
          const row = store[name].find(d => d._id === id);
          if (row) Object.assign(row, data);
          return { stats: { updated: row ? 1 : 0 } };
        }
      };
    }
  };
  return q;
}

const fakeCloud = {
  init() {},
  database() {
    return {
      command: { gt: value => ({ __op: 'gt', value }) },
      collection(name) {
        if (!store[name]) store[name] = [];
        return makeQuery(name, {}, {});
      },
      serverDate() { return '__SERVER_DATE__'; }
    };
  },
  getWXContext() { return { OPENID: currentOpenid }; },
  openapi: {
    security: {
      async msgSecCheck() { return { errCode: 0 }; }
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fakeCloud;
  return originalLoad.apply(this, arguments);
};

const fn = require(path.join(__dirname, '..', 'cloudfunctions', 'bookcorner', 'index.js'));

// ===================== 测试数据 =====================
function seed() {
  store.config.length = 0;
  store.user.length = 0;
  store.book.length = 0;
  store.book_comment.length = 0;
  store.exchange_log.length = 0;

  store.config.push({ _id: 'cfg', key: 'app', maintenance: false, sensitiveWords: ['加微信', '刷单'] });
  store.user.push({ _id: 'user_1', _openid: 'openid_test', nickName: '小石' });
  store.space.push({ _id: 'space_stnh_001', name: '石大年华·茶咖空间', status: 'active' });
  store.book.push({ _id: 'book_1', spaceId: 'space_stnh_001', title: '能源通识导论', category: '能源通识', intro: '', zone: 'A', status: 'on', sort: 1, createdAt: new Date('2026-09-17T02:10:00Z') });
  store.book.push({ _id: 'book_2', spaceId: 'space_stnh_001', title: '人间草木', category: '文学散文', intro: '汪曾祺散文集', zone: 'A', status: 'on', sort: 2, createdAt: new Date('2026-09-17T02:11:00Z') });
  store.book.push({ _id: 'book_3', spaceId: 'space_stnh_001', title: '下架书', category: '文学散文', intro: '', zone: 'A', status: 'off', sort: 3, createdAt: new Date('2026-09-17T02:12:00Z') });
}

// ===================== 断言工具 =====================
let pass = 0;
let fail = 0;
function check(name, condition, extra) {
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
}

async function run() {
  console.log('\n[1] getBooks：只回上架书、只回 4 个字段');
  seed();
  let res = await fn.main({ action: 'getBooks', spaceId: 'space_stnh_001' });
  check('code=0', res.code === 0, res);
  check('只回 2 本上架书（下架书被过滤）', res.total === 2, res.total);
  check('字段只有 _id/title/category/intro', Object.keys(res.data[0]).sort().join(',') === '_id,category,intro,title', Object.keys(res.data[0]));
  check('按 sort 升序', res.data[0]._id === 'book_1' && res.data[1]._id === 'book_2');
  check('返回分类列表', Array.isArray(res.categories) && res.categories.length === 2, res.categories);

  res = await fn.main({ action: 'getBooks', spaceId: 'space_stnh_001', category: '文学散文' });
  check('category 过滤生效', res.total === 1 && res.data[0]._id === 'book_2', res);

  res = await fn.main({ action: 'getBooks', spaceId: '' });
  check('缺 spaceId 报错', res.code === -1, res);

  console.log('\n[2] getBookDetail / getComments：不返回待审留言');
  seed();
  const addPending = await fn.main({ action: 'addComment', bookId: 'book_1', content: '加微信 私聊我' });
  check('命中敏感词 → pending', addPending.data.status === 'pending', addPending);
  const addOk = await fn.main({ action: 'addComment', bookId: 'book_1', content: '  这本书很适合入门  ' });
  check('干净内容 → approved', addOk.data.status === 'approved', addOk);
  check('统一提示文案', addOk.msg === '留言已提交，将在审核后展示', addOk.msg);

  const detail = await fn.main({ action: 'getBookDetail', bookId: 'book_1' });
  check('详情 code=0', detail.code === 0, detail);
  check('commentTotal 只算 approved', detail.data.commentTotal === 1, detail.data.commentTotal);
  check('详情不返回留言数组', detail.data.comments === undefined, Object.keys(detail.data));

  const comments = await fn.main({ action: 'getComments', bookId: 'book_1' });
  check('留言列表只含 approved', comments.data.length === 1 && comments.data[0].status === undefined, comments.data);
  check('留言内容已去首尾空白', comments.data[0].content === '这本书很适合入门', comments.data[0].content);
  check('昵称取自服务端 user 集合', comments.data[0].nickname === '小石', comments.data[0].nickname);
  check('条目含 starred 字段供精选标使用', comments.data[0].starred === false);

  console.log('\n[3] addComment：边界与鉴权');
  seed();
  const longText = '字'.repeat(260);
  const longRes = await fn.main({ action: 'addComment', bookId: 'book_1', content: longText });
  check('超长内容被服务端截断到 200 字', store.book_comment[0].content.length === 200, store.book_comment[0].content.length);
  check('超长仍返回成功', longRes.code === 0, longRes);

  const emptyRes = await fn.main({ action: 'addComment', bookId: 'book_1', content: '   ' });
  check('空内容报错', emptyRes.code === -1 && store.book_comment.length === 1, emptyRes);

  const noBook = await fn.main({ action: 'addComment', bookId: 'book_x', content: 'hello' });
  check('书不存在时拒绝', noBook.code === -1, noBook);

  currentOpenid = '';
  const noLogin = await fn.main({ action: 'addComment', bookId: 'book_1', content: 'hello' });
  check('未登录拒绝写操作', noLogin.code === -1 && noLogin.msg === '请先登录', noLogin);
  currentOpenid = 'openid_test';

  currentOpenid = 'openid_stranger';
  const stranger = await fn.main({ action: 'addComment', bookId: 'book_1', content: 'hello' });
  check('无 user 文档时提示先登录', stranger.code === -1, stranger);
  currentOpenid = 'openid_test';

  console.log('\n[4] addExchange：幂等与截断');
  seed();
  const ex1 = await fn.main({ action: 'addExchange', spaceId: 'space_stnh_001', bookTitle: '能源通识导论', giveTitle: '高数上册' });
  check('首次登记成功', ex1.code === 0 && store.exchange_log.length === 1, ex1);
  const ex2 = await fn.main({ action: 'addExchange', spaceId: 'space_stnh_001', bookTitle: '能源通识导论', giveTitle: '高数上册' });
  check('10 分钟内重复登记不新增流水', ex2.code === 0 && store.exchange_log.length === 1 && ex2.data.duplicated === true, ex2);

  const ex3 = await fn.main({ action: 'addExchange', spaceId: 'space_stnh_001', bookTitle: '人间草木', giveTitle: '线性代数' });
  check('不同书名可再次登记', ex3.code === 0 && store.exchange_log.length === 2, ex3);
  check('昵称取自服务端', store.exchange_log[0].nickname === '小石', store.exchange_log[0].nickname);
  check('userId 存 user._id 而非 openid', store.exchange_log[0].userId === 'user_1', store.exchange_log[0].userId);

  const exLong = await fn.main({ action: 'addExchange', spaceId: 'space_stnh_001', bookTitle: 'X'.repeat(80), giveTitle: 'Y'.repeat(80) });
  check('超长书名截断到 50 字', store.exchange_log[store.exchange_log.length - 1].bookTitle.length === 50, store.exchange_log[store.exchange_log.length - 1].bookTitle.length);
  check('超长登记仍成功', exLong.code === 0, exLong);

  const exMiss = await fn.main({ action: 'addExchange', spaceId: 'space_stnh_001', bookTitle: '书', giveTitle: '' });
  check('缺字段报错', exMiss.code === -1, exMiss);

  console.log('\n[5] 未知 action 与维护模式');
  seed();
  const unknown = await fn.main({ action: 'nope' });
  check('未知 action 返回 -1', unknown.code === -1 && unknown.msg === '未知操作', unknown);

  store.config[0].maintenance = true;
  const maint = await fn.main({ action: 'addComment', bookId: 'book_1', content: '维护中留言' });
  check('维护模式拒绝留言', maint.code === -1 && maint.msg.indexOf('维护') > -1, maint);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });

// tests/helpers/fake-cloud.js —— 云函数本地测试用的内存版 wx-server-sdk
//
// 用法：
//   const { createHarness } = require('./helpers/fake-cloud');
//   const h = createHarness({ config: [...], user: [...] });
//   const fn = h.load('bookcorner');
//   await fn.main({ action: 'getBooks', ... });
const path = require('path');
const Module = require('module');

function matches(doc, where) {
  return Object.keys(where).every(key => {
    const cond = where[key];
    const value = doc[key];
    if (cond && typeof cond === 'object' && cond.__op) {
      if (cond.__op === 'gt') return new Date(value).getTime() > new Date(cond.value).getTime();
      if (cond.__op === 'in') return cond.value.indexOf(value) > -1;
      if (cond.__op === 'exists') return cond.value ? value !== undefined : value === undefined;
      return true;
    }
    return value === cond;
  });
}

function createHarness(initialData) {
  const store = {};
  Object.keys(initialData || {}).forEach(name => { store[name] = initialData[name].slice(); });
  let currentOpenid = 'openid_test';
  let nextId = 1;

  function makeQuery(name, where, state) {
    const st = Object.assign({ skip: 0, limit: 20, order: [], fields: null }, state);
    const q = {
      where(nextWhere) { return makeQuery(name, nextWhere, st); },
      orderBy(field, dir) { st.order = st.order.concat([[field, dir]]); return q; },
      field(spec) { st.fields = spec; return q; },
      skip(n) { st.skip = n; return q; },
      limit(n) { st.limit = n; return q; },
      async get() {
        if (!store[name]) store[name] = [];
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
        if (!store[name]) store[name] = [];
        return { total: store[name].filter(doc => matches(doc, where)).length };
      },
      async add({ data }) {
        if (!store[name]) store[name] = [];
        const doc = Object.assign({}, data);
        doc._id = doc._id || (name + '_' + (nextId++));
        store[name].push(doc);
        return { _id: doc._id };
      },
      async update({ data }) {
        if (!store[name]) store[name] = [];
        store[name] = store[name].map(doc => (matches(doc, where) ? Object.assign(doc, data) : doc));
        return { stats: { updated: 1 } };
      },
      doc(id) {
        return {
          async get() { return { data: (store[name] || []).find(d => d._id === id) || null }; },
          async update({ data }) {
            const row = (store[name] || []).find(d => d._id === id);
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
        command: {
          gt: value => ({ __op: 'gt', value }),
          in: value => ({ __op: 'in', value }),
          exists: value => ({ __op: 'exists', value }),
          remove: () => ({ __op: 'remove' })
        },
        collection(name) {
          if (!store[name]) store[name] = [];
          return makeQuery(name, {}, {});
        },
        serverDate() { return new Date(); }
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
  Module._load = function (request) {
    if (request === 'wx-server-sdk') return fakeCloud;
    return originalLoad.apply(this, arguments);
  };

  return {
    store,
    fakeCloud,
    setOpenid(openid) { currentOpenid = openid; },
    load(cloudFunctionName) {
      return require(path.join(__dirname, '..', '..', 'cloudfunctions', cloudFunctionName, 'index.js'));
    }
  };
}

module.exports = { createHarness };

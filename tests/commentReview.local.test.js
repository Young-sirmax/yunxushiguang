// tests/commentReview.local.test.js —— commentReview 云函数本地冒烟测试（重点：权限不可绕过）
// 运行：node tests/commentReview.local.test.js
const { createHarness } = require('./helpers/fake-cloud');

const SPACE = 'space_stnh_001';

function baseData() {
  return {
    config: [{ _id: 'cfg', key: 'app', maintenance: false }],
    user: [
      { _id: 'user_plain', _openid: 'openid_plain', nickName: '普通同学' },
      { _id: 'user_admin', _openid: 'openid_admin', nickName: '平台管理员', isAdmin: true },
      { _id: 'user_roleadmin', _openid: 'openid_roleadmin', nickName: '角色管理员', role: 'admin' },
      { _id: 'user_mgr', _openid: 'openid_mgr', nickName: '空间管理员', role: 'space_manager' },
      { _id: 'user_mgr_norole', _openid: 'openid_mgr_norole', nickName: '名单内但无角色' },
      { _id: 'user_other_mgr', _openid: 'openid_other_mgr', nickName: '别的空间管理员', role: 'space_manager' }
    ],
    space: [
      { _id: SPACE, name: '石大年华·茶咖空间', status: 'active', managers: ['user_mgr', 'user_mgr_norole'] },
      { _id: 'space_other', name: '其他空间', status: 'active', managers: ['user_other_mgr'] }
    ],
    book: [
      { _id: 'book_1', spaceId: SPACE, title: '能源通识导论', category: '能源通识', cover: '', zone: 'A', status: 'on', sort: 1 },
      { _id: 'book_2', spaceId: 'space_other', title: '别的空间的书', category: '文学散文', cover: '', zone: 'B', status: 'on', sort: 1 }
    ],
    book_comment: [
      { _id: 'c_pending', bookId: 'book_1', spaceId: SPACE, userId: 'user_plain', nickname: '普通同学', content: '待审留言', status: 'pending', starred: false, createdAt: new Date('2026-09-17T03:00:00Z') },
      { _id: 'c_approved', bookId: 'book_1', spaceId: SPACE, userId: 'user_plain', nickname: '普通同学', content: '已通过留言', status: 'approved', starred: false, createdAt: new Date('2026-09-17T04:00:00Z') },
      { _id: 'c_rejected', bookId: 'book_1', spaceId: SPACE, userId: 'user_plain', nickname: '普通同学', content: '被拒留言', status: 'rejected', starred: false, createdAt: new Date('2026-09-17T05:00:00Z') },
      { _id: 'c_other_space', bookId: 'book_2', spaceId: 'space_other', userId: 'user_plain', nickname: '普通同学', content: '别的空间留言', status: 'pending', starred: false, createdAt: new Date('2026-09-17T06:00:00Z') }
    ],
    op_log: []
  };
}

let pass = 0;
let fail = 0;
function check(name, condition, extra) {
  if (condition) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

async function run() {
  const h = createHarness(baseData());
  const fn = h.load('commentReview');

  console.log('\n[1] 权限：普通用户一律拒绝');
  h.setOpenid('openid_plain');
  let res = await fn.main({ action: 'getPending', spaceId: SPACE });
  check('普通用户读待审列表被拒', res.code === -1 && res.msg === '无权限', res);
  res = await fn.main({ action: 'approve', commentId: 'c_pending' });
  check('普通用户不能通过留言', res.code === -1 && res.msg === '无权限', res);
  check('留言状态未被改动', h.store.book_comment.find(c => c._id === 'c_pending').status === 'pending');
  check('未写 op_log', h.store.op_log.length === 0);

  console.log('\n[2] 权限：平台管理员（isAdmin / role=admin）放行');
  h.setOpenid('openid_admin');
  res = await fn.main({ action: 'getPending', spaceId: SPACE });
  check('isAdmin 可读待审列表', res.code === 0, res);
  check('待审只含本空间 pending', res.data.length === 1 && res.data[0]._id === 'c_pending', res.data);
  check('角标 pendingCount 正确', res.pendingCount === 1, res.pendingCount);
  check('联表带出书名', res.data[0].bookTitle === '能源通识导论', res.data[0]);

  h.setOpenid('openid_roleadmin');
  res = await fn.main({ action: 'getApproved', spaceId: SPACE, status: 'approved' });
  check('role=admin 可读已通过列表', res.code === 0 && res.total === 1, res);

  console.log('\n[3] 权限：空间管理员仅限本空间');
  h.setOpenid('openid_mgr');
  res = await fn.main({ action: 'getPending', spaceId: SPACE });
  check('本空间管理员可读', res.code === 0, res);
  res = await fn.main({ action: 'getPending', spaceId: 'space_other' });
  check('越权读其他空间被拒', res.code === -1 && res.msg === '无权限', res);
  res = await fn.main({ action: 'approve', commentId: 'c_other_space' });
  check('越权审核其他空间的留言被拒', res.code === -1 && res.msg === '无权限', res);
  check('其他空间留言未被改动', h.store.book_comment.find(c => c._id === 'c_other_space').status === 'pending');

  h.setOpenid('openid_mgr_norole');
  res = await fn.main({ action: 'getPending', spaceId: SPACE });
  check('名单内但无 space_manager 角色 → 拒绝（双条件）', res.code === -1, res);

  console.log('\n[4] 审核动作与 op_log');
  h.setOpenid('openid_admin');
  res = await fn.main({ action: 'approve', commentId: 'c_pending' });
  check('通过成功', res.code === 0 && res.data.status === 'approved', res);
  check('op_log 记 comment_approve', h.store.op_log.some(l => l.action === 'comment_approve' && l.targetId === 'c_pending'), h.store.op_log);
  check('op_log 带角色快照', h.store.op_log[0].operatorRole === 'platform_admin', h.store.op_log[0]);
  check('op_log 带 operatorId', h.store.op_log[0].operatorId === 'user_admin');

  res = await fn.main({ action: 'star', commentId: 'c_approved' });
  check('加精成功', res.code === 0 && res.data.starred === true, res);
  res = await fn.main({ action: 'unstar', commentId: 'c_approved' });
  check('取消加精成功', res.code === 0 && res.data.starred === false, res);
  res = await fn.main({ action: 'reject', commentId: 'c_approved' });
  check('驳回成功', res.code === 0 && res.data.status === 'rejected', res);
  check('op_log 累计 4 条', h.store.op_log.length === 4, h.store.op_log.length);

  res = await fn.main({ action: 'approve', commentId: 'not_exist' });
  check('留言不存在时拒绝', res.code === -1 && res.msg === '留言不存在', res);
  res = await fn.main({ action: 'getApproved', spaceId: SPACE, status: 'bad' });
  check('非法 status 拒绝', res.code === -1, res);

  console.log('\n[5] 其他边界');
  res = await fn.main({ action: 'nope' });
  check('未知 action 拒绝', res.code === -1 && res.msg === '未知操作', res);
  h.setOpenid('openid_unknown');
  res = await fn.main({ action: 'getPending', spaceId: SPACE });
  check('无 user 文档时提示登录', res.code === -1 && res.msg === '请先登录', res);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });

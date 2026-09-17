# 公益图书角 · 第二遍独立审查（只报问题，不改代码）

> 对应 Kimi「指令 2：第二遍审查」要求，对照 `docs/01-开发需求.md` 与 `docs/02-技术规范.md`
> 审查范围：`cloudfunctions/bookcorner`、`cloudfunctions/commentReview`、`cloudfunctions/config`（敏感词部分）、
> `miniprogram/pages/bookcorner/*`、`miniprogram/pages/admin/*`（留言审核模块）、`miniprogram/api/api.js`
>
> ⚠️ 诚实说明：本次由同一执行者做对照审查（Claude Code 未参与），因此**不能算完全无关联的第三方视角**。
> 建议后续把这份报告连同代码丢给另一个模型做二遍交叉审查。

## 🔴 必须修

1. **管理端空间写死**：`miniprogram/pages/admin/admin.js:13` `DEFAULT_SPACE_ID = 'space_stnh_001'`。
   一旦有第二个图书角空间，审核页会只看第一个空间、且看不到切换入口。当前单空间可用，属于上线前必须收口项。
   建议：给 `bookcorner` 加 `listSpaces`，管理端改为空间下拉。

2. **留言可以对「已下架」的书提交**：`cloudfunctions/bookcorner/index.js:267` `addComment` 只校验书是否存在，未校验 `book.status === 'on'`。
   后果：书下架后仍能被留言。建议补一条状态校验（或明确保留，作为"下架书保留讨论"的产品决策）。

3. **`config.sensitiveWords` 目前为空**：控制台 `config` 记录里还没有该字段。
   影响：`bookcorner` 会走**内置兜底词表**（功能正常），但「改控制台即生效」这条运营承诺尚未真正可用。
   处理：控制台 → 数据库 → config → key=app 记录 → 添加字段 `sensitiveWords`（数组，15 个词见 `seed/config-sensitive-words.json`）；
   或调用已部署的引导动作 `{"action":"initSensitiveWords"}`。

## 🟡 建议修

4. **空间管理员角色无处设置**：`cloudfunctions/commentReview/index.js:64` 要求 `user.role === 'space_manager'`，
   但 `admin` 云函数只提供 `isAdmin` 开关，没有写 `role` 的入口。结果：只有平台管理员能审留言，空间管理员实际用不了。
   建议：`admin` 云函数补一个 `setRole`，或在管理端用户卡片加「设为空间管理员」并同步写 `space.managers`。

5. **加精置顶依赖复合索引**：`cloudfunctions/bookcorner/index.js:235` 用 `orderBy('starred','desc') + orderBy('createdAt','asc')`，
   而 `docs/bookcorner-schema.md` 只登记了 `bookId + status` 索引。已做 try/catch 降级（失败则按时间排序并在页内把精选提前），
   但最好在控制台补一条 `book_comment: bookId + status + starred + createdAt` 复合索引。

6. **留言没有防刷与去重**：`cloudfunctions/bookcorner/index.js:267`
   `docs/bookcorner-schema.md` 建议「同一用户对同一本书只保留一条未驳回评论」以及复用 `rate_limit` 限流，当前都没做。
   后果：单人可刷满一页留言。建议至少加「同书同人 10 分钟内 1 条」。

7. **分类列表上限 200**：`cloudfunctions/bookcorner/index.js:160` 用 `limit(MAX_PAGE_SIZE * 10)` 取分类，
   书目超过 200 本时分类可能不全。建议改为按需缓存或后端 distinct。

8. **敏感词变体覆盖有限**：`cloudfunctions/bookcorner/index.js` 的 `normalizeForMatch` 只做小写 + 去空白/常见分隔符，
   拦不住「加威信」「VX」等同义变体。建议词表里补同义写法（运营层面即可解决）。

9. **留言提交后列表无即时反馈**：`miniprogram/pages/bookcorner/detail.js` 提交成功后只刷新「留言条数」，不把自己那条插入列表。
   这是为了「不暴露审核机制」的有意设计，但用户可能觉得"没提交上"。建议在成功 toast 后加一行引导文案（如「审核通过后会出现在下面」）。

10. **`detail` 页书不存在时体验差**：`miniprogram/pages/bookcorner/detail.js:29` 只 toast，不返回也不显示空态。

## 🔵 可选优化

11. **换书幂等基于书名精确匹配**：`cloudfunctions/bookcorner/index.js:315`，书名多空格/多一字即可绕过。可加书名归一化（去空白）后再比对。

12. **`getBooks` 未过滤空间状态**：空间 `status='frozen'` 时书目仍可被拉取（`getSpace` 有挡，但列表接口没挡）。冻结空间本就不该展示，建议同步加。

13. **留言列表字段投影不含 `status`**：`bookcorner.getComments` 已隐含 `status='approved'`，前端无需再判断，属可读性优化。

14. **审核记录粒度**：`op_log.detail` 目前只记 `from/starred`，没记驳回原因。若后续需要"驳回理由"（对照 `space.reject_reason` 模式），需扩字段。

15. **测试覆盖**：本地测试用的内存假数据库不校验索引与真实 `serverDate`，属于"逻辑自测"，不能替代云端真机联调。

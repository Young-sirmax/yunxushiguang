# 公益图书角 · 数据层设计（bookcorner）

> 版本：v1 · 2026-09-17
> 适用范围：公益图书角（共享空间 / 图书 / 评论 / 互换 / 操作日志）
> 关联文档：《数据迁移与索引.md》《运维手册.md》

---

## 零、总则

### 0.1 与现有集合的关系

本模块**新建 5 个集合，不复用 `commodity`**。原因：现有 `commodity` 承载的是「闲置 / 求购 / 以物易物 / 技能服务」四类**交易**语义，`tradeStatus` 只有
`open / matched / completed`；图书角是**共享借阅**语义（无价格、无成交、按 `zone` 分区、书评需审核），硬塞进 `commodity` 会污染
`cloudfunctions/commodity/index.js`（1059 行）并让双方的状态机互相干扰。

> 注意区分：现有 `commodity` 内的「图书专区」（`utils/majors.js` + `commodity.major` 数组 + 学院/专业二级筛选）是**卖二手教材**的功能，
> 与本次「公益图书角」是**两个独立功能**，互不影响，也不需要改写。

### 0.2 命名约定

| 约定 | 说明 |
|---|---|
| 主键 | 一律 `_id`，由云函数或导入文件指定；**不要**依赖自动生成，因为 `book.spaceId` 等外键需要稳定引用 |
| 外键 | 统一命名 `<实体>Id`，值为目标文档的 `_id`（字符串） |
| 时间 | 本模块统一用 `createdAt` / `updatedAt`（**注意**：`commodity`、`user` 用的是 `createTime` / `updateTime`，`review` 用的是 `created_at`——历史遗留三套命名并存，本模块从新从简，不再扩散） |
| 用户标识 | `userId` 存 `user._id`（文档主键），**不存 openid**。现有 `review.userId` 曾存 openid，本模块不沿用该做法 |
| 无 `_openid` | 本模块所有集合**仅由云函数写入**，因此不会自动带 `_openid` 字段（云开发只在客户端写入时才自动注入）。云函数鉴权一律用 `cloud.getWXContext().OPENID` 反查 `user` 集合 |
| 软删除 | 一律用 `status` 状态位，不做物理删除（`op_log` 除外） |

### 0.3 集合权限（**全部 5 个集合一致**）

云开发控制台 → 数据库 → 集合 → 权限设置 → 选择 **「所有用户不可读写」（仅管理端可读写）**。

理由：云函数以管理员身份访问数据库，**不受集合权限约束**；客户端则完全禁止直连。前端所有读写必须走云函数，鉴权与内容安全才有唯一收口。
（现有 `user` / `commodity` / `config` / `review` 等集合也是这个策略。）

### 0.4 索引建议

云开发控制台 → 数据库 → 集合 → 索引管理 → 添加索引。

| 集合 | 索引字段 | 类型 | 用途 |
|---|---|---|---|
| `space` | `status` | 升序 | 空间列表过滤 |
| `book` | `spaceId` + `status` | 复合，均升序 | 图书角主页按空间拉上架图书 |
| `book` | `spaceId` + `zone` + `sort` | 复合 | 按 A/B 分区展示并保序 |
| `book_comment` | `bookId` + `status` | 复合 | 单本书的已通过评论 |
| `book_comment` | `spaceId` + `status` | 复合 | 空间维度的评论审核列表 |
| `exchange_log` | `spaceId` + `createdAt` | 复合，后者降序 | 空间最新互换动态 |
| `op_log` | `spaceId` + `createdAt` | 复合，后者降序 | 空间操作流水 |
| `op_log` | `targetId` | 升序 | 追溯某条目标记录的完整操作历史 |

> 未建索引的查询会随数据量线性变慢，P99 ≥ 300ms 时优先排查此处（见《运维手册》第二节）。

---

## 一、`space` —— 图书角空间

一个「空间」= 一个独立的图书角（公益茶咖、书店、社团、官方馆）。**所有其他 4 个集合都挂在空间下**，是多租户的根。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `_id` | string | ✅ | — | 主键。建议 `space_<短标识>`，如 `space_stnh_001` |
| `name` | string | ✅ | — | 空间名称，展示用。长度建议 ≤ 20 字 |
| `type` | string | ✅ | — | 空间类型枚举：`welfare`（公益）/ `shop`（商业书店）/ `club`（社团）/ `official`（官方）|
| `logo` | string | ⬜ | `''` | 云存储 `fileID`（`cloud://` 开头）。空串表示用前端默认占位图 |
| `managers` | string[] | ✅ | `[]` | 空间管理员，元素为 `user._id`。**空数组 = 暂无人管理，仅平台管理员可操作** |
| `modules` | string[] | ✅ | `["bookcorner"]` | 该空间启用的功能模块。首期仅 `bookcorner`，为后续扩展（如 `donation` / `activity`）预留 |
| `status` | string | ✅ | `active` | `active`（正常）/ `frozen`（冻结，前端不展示、不可写入）|
| `createdAt` | Date | ✅ | — | 创建时间 |

**写入方**：平台管理员（`admin` 云函数）创建；`managers` 由空间管理员自助维护。

**枚举约束**
```
type   : welfare | shop | club | official
status : active | frozen
modules: 至少 1 项，首期合法值 ["bookcorner"]
```

**说明**
- `managers` 存 `user._id` 而非 openid，与现有 `admin` 云函数的 `isAdmin` 布尔字段是**两套独立权限**：`isAdmin` 是平台级管理员，`managers` 是空间级管理员。判断顺序应为「平台管理员 → 放行；否则查 managers」。
- 不要给 `managers` 设上限过小，但要限制数组长度防滥用（建议 ≤ 10）。

---

## 二、`book` —— 图书

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `_id` | string | ✅ | — | 主键。建议 `book_<短标识>` |
| `spaceId` | string | ✅ | — | 外键 → `space._id` |
| `title` | string | ✅ | — | 书名，≤ 50 字 |
| `author` | string | ⬜ | `''` | 作者，≤ 30 字 |
| `category` | string | ✅ | — | 分类，字符串（非外键）。示例：`能源通识` / `文学散文` / `人文社科`。**首期用自由字符串 + 前端固定下拉**，不引入 `category` 集合并行表；后续若需运营可配再迁移 |
| `cover` | string | ⬜ | `''` | **允许为空字符串**。云存储 `fileID`。为空时前端渲染书名首字占位块 |
| `intro` | string | ⬜ | `''` | **允许为空字符串**。简介，≤ 200 字 |
| `zone` | string | ✅ | — | 分区，枚举 `A` / `B`。用于书架物理位置 |
| `status` | string | ✅ | `on` | `on`（上架）/ `off`（下架）。下架不删除文档 |
| `sort` | number | ✅ | `0` | 同分区内排序，升序。允许负数与重复（重复时按 `createdAt` 兜底） |
| `createdAt` | Date | ✅ | — | 创建时间 |
| `updatedAt` | Date | ✅ | — | 末次修改时间，由云函数在每次 update 时刷新 |

**写入方**：空间管理员（`managers`）。

**关于 `cover` / `intro` 允许空串的说明**
云开发数据库允许字段值为空字符串，无需特殊处理。但要**避免「字段缺失」与「字段为空串」混用**——两种状态在前端会产生不同的兜底分支。约定：
**新增文档时必须显式写入 `cover: ""` / `intro: ""`**（如本次种子数据），云函数更新时也只写空串、不删字段。

**内容安全**：`title` / `author` / `intro` 写入前须过 `cloud.openapi.security.msgSecCheck`；
`cover` 非空时须过 `imgSecCheck`。降级策略沿用现有实现（接口异常时放行并记日志）——见
`cloudfunctions/user/index.js` 的 `checkTextSecurity` / `checkImageSecurity`。

---

## 三、`book_comment` —— 书评

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `_id` | string | ✅ | — | 主键 |
| `bookId` | string | ✅ | — | 外键 → `book._id` |
| `spaceId` | string | ✅ | — | 冗余外键 → `space._id`。**故意的反范式**：空间维度的评论审核列表可免去 join，按 `spaceId + status` 一次查完 |
| `userId` | string | ✅ | — | 外键 → `user._id`。由云函数从 openid 反查写入，**不接受客户端传入** |
| `nickname` | string | ✅ | — | 评论时的昵称**快照**。用户后续改昵称不回填历史评论（与 `commodity` 存 `sellerName` 的做法一致） |
| `content` | string | ✅ | — | 评论正文，≤ 200 字 |
| `status` | string | ✅ | `pending` | `pending`（待审）/ `approved`（通过）/ `rejected`（驳回）。**默认 `pending`** |
| `starred` | boolean | ✅ | `false` | 管理员标星（精选）。与 `status` 正交，仅 `approved` 的评论有意义 |
| `createdAt` | Date | ✅ | — | 创建时间 |

**写入方**：登录用户创建（`status: 'pending'`）；空间管理员改 `status` / `starred`。

**枚举约束**
```
status: pending | approved | rejected
```

**审核流**
```
提交 → pending ──管理员通过──→ approved ──标星──→ approved + starred=true
            └──管理员驳回──→ rejected（可复用 space.reject_reason 模式存原因）
```

**内容安全**：提交时先过 `msgSecCheck`，再过 `config.sensitiveWords` 本地词表。
**两者都要做**：`msgSecCheck` 覆盖违法内容但有时延与配额限制；本地词表覆盖「加微信 / 刷单 / 代写」这类平台自定的引流与违规交易词，是 `msgSecCheck` 不拦的。

**防刷**：建议限制单用户对同一本书只能有一条未驳回评论（照 `cloudfunctions/review/index.js` 的 `checkByPost` 去重写法）。
频控可复用现有 `rate_limit` 集合（见 `commodity` 云函数的 `checkContactAccess`）。

---

## 四、`exchange_log` —— 互换记录

记录「某本书被换走 / 换成了什么」的流水。**这是一条流水，不是状态**——`book` 文档本身不带借出状态。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `_id` | string | ✅ | — | 主键 |
| `spaceId` | string | ✅ | — | 外键 → `space._id` |
| `bookTitle` | string | ✅ | — | 换出书名**快照**。书可能被下架或改名，流水须保持当时的记录 |
| `giveTitle` | string | ✅ | — | 换来的书名。**纯公益赠与场景填 `'公益赠阅'`**（不使用空串，避免与「字段缺失」混淆） |
| `nickname` | string | ✅ | — | 操作人昵称快照 |
| `userId` | string | ✅ | — | 外键 → `user._id` |
| `createdAt` | Date | ✅ | — | 互换时间 |

**写入方**：空间管理员（`managers`）。

**为什么存书名快照而不是 `bookId`**
互换是**已发生的历史事实**。若存 `bookId` 而书后来被删/改名，流水就失真了。因此本集合**刻意不存 `bookId`**，
只存快照字符串。这是与 `book_comment`（存 `bookId`，因为评论永远依附于那本书）的**有意区别**。

---

## 五、`op_log` —— 操作日志

审计流水。**只增不改不删**（唯一不做软删除的集合）。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `_id` | string | ✅ | — | 主键 |
| `spaceId` | string | ✅ | — | 外键 → `space._id` |
| `operatorId` | string | ✅ | — | 操作人 `user._id`。**系统自动操作填 `'system'`** |
| `operatorRole` | string | ✅ | — | 操作时的角色快照。枚举：`platform_admin` / `space_manager` / `user` / `system` |
| `action` | string | ✅ | — | 动作枚举，见下 |
| `targetId` | string | ✅ | — | 被操作文档的 `_id`。无具体目标时填 `spaceId` |
| `detail` | object | ⬜ | `{}` | 结构化补充信息。**不要塞长文本**，只放可检索的键值对（如 `{ from: 'A', to: 'B' }`） |
| `createdAt` | Date | ✅ | — | 操作时间 |

**写入方**：全部由云函数在业务动作成功后追加。

**`action` 建议枚举**
```
book_create      book_update      book_delete      book_zone_change
book_on          book_off
comment_approve  comment_reject   comment_delete   comment_star
space_update     space_freeze     space_unfreeze
manager_add      manager_remove
```

**为什么 `operatorRole` 要存快照**
管理员身份会变。日志必须记录「当时以什么身份做的」，否则事后追责时角色已被撤销，无法还原。

**容量提醒**
`op_log` 是唯一会无限增长的集合。上线后按季度归档（导出后删除 N 个月前的记录，派发到 `del_trigger` 或定时任务）。
现有 `del_trigger` 云函数是触发器模式，可参考。

---

## 六、`config` 集合的扩展（**不是新集合**）

敏感词表不新建集合，复用现有 `config` 集合 `key: 'app'` 那条记录，新增字段：

```json
{
  "key": "app",
  "maintenance": false,
  "notice": "系统维护中，请稍后再试",
  "admin_openids": ["oXXXX-xxxxxxxxxxxxxxxxxxx"],
  "skill_categories": ["项目辅导", "..."],
  "skill_price_ref": { "...": {} },
  "sensitiveWords": ["加微信", "扫码加", "..."]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `sensitiveWords` | string[] | 敏感词表。**与 `skill_categories` 完全平行**：改控制台即生效，无需重新部署云函数；留空/非法时云函数用内置默认词表兜底 |

**为什么复用 `config` 而不是新建集合**
`config` 已经是本项目的「运行时可变配置」唯一入口，且已有 `readAppConfig` + `normalizeSkillCategories` 的成熟模式
（`cloudfunctions/config/index.js`）。新建集合会引入第二条配置读取路径，徒增维护成本。

**为什么不下发给客户端**
与 `admin_openids` 同理——下发词表等于告诉用户如何绕过。`action: 'get'` **不返回** `sensitiveWords`。
云函数内部按需自行读取集合（照 `user/index.js` 的 `isMaintenanceOn()` 模式直连读取，不要跨函数调用）。

---

## 七、完整字段速查

```
space
  _id  name  type(welfare|shop|club|official)  logo  managers[userId]
  modules[]  status(active|frozen)  createdAt

book
  _id  spaceId→space  title  author  category  cover  intro
  zone(A|B)  status(on|off)  sort  createdAt  updatedAt

book_comment
  _id  bookId→book  spaceId→space  userId→user  nickname
  content  status(pending|approved|rejected)  starred(false)  createdAt

exchange_log
  _id  spaceId→space  bookTitle  giveTitle  nickname  userId→user  createdAt

op_log
  _id  spaceId→space  operatorId  operatorRole  action  targetId  detail{}  createdAt
```

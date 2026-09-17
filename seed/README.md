# seed/ —— 公益图书角种子数据

> 字段定义见 [docs/bookcorner-schema.md](../docs/bookcorner-schema.md)

## 文件说明

| 文件 | 用途 | 是否可直接导入 |
|---|---|---|
| `space.json` | 1 条空间文档 | ✅ 控制台导入 |
| `book.json` | 3 条测试图书文档 | ✅ 控制台导入 |
| `config-sensitive-words.json` | 15 个敏感词 | ❌ **仅供复制粘贴**，见下 |

## ⚠️ 格式说明（重要）

`space.json` / `book.json` 是 **JSON Lines 格式**，不是 JSON 数组：

```
{"_id":"...","name":"..."}     ← 第一行
{"_id":"...","name":"..."}     ← 第二行
```

**每行一个完整 JSON 对象，行尾无逗号，文件外层无 `[` `]`。** 这是云开发控制台导入的唯一合法格式——
写成数组会导入失败。时间字段用 ISODate 扩展格式 `{"$date":"2026-09-17T02:00:00.000Z"}`。
文件须为 **UTF-8 无 BOM** 编码。

## 导入步骤

1. 云开发控制台 → 数据库 → 先建好 `space` 集合（详见《bookcorner-schema.md》）
2. 集合右上角 **导入** → 选择 `space.json`
3. 冲突处理模式选 **Insert**（首次导入，不覆盖已有数据）
4. 导入完成后，用**同样的步骤**导入 `book.json` 到 `book` 集合
5. **必须先导入 `space.json` 再导入 `book.json`**——`book.spaceId` 引用了空间文档的 `_id`

## 关于 `config-sensitive-words.json`

这个文件是**纯 JSON 数组**，**不能用于数据库导入**。它的用途是：

1. 云开发控制台 → 数据库 → `config` 集合 → 找到 `key: "app"` 的记录 → 编辑
2. 新增字段 `sensitiveWords`，类型选 **数组**
3. 把文件内容整个复制粘贴进去
4. 保存即生效，**无需重新部署云函数**

若 `config` 集合里还没有 `key: "app"` 的记录，请先参考《运维手册.md》第三节创建。

## 导入后验证

```js
// 在云开发控制台 → 数据库 → 高级操作 里可直接运行
db.collection('space').where({ _id: 'space_stnh_001' }).get()
db.collection('book').where({ spaceId: 'space_stnh_001' }).orderBy('sort', 'asc').get()
```

预期：空间 1 条，图书 3 条，均为 `zone: "A"`、`status: "on"`、`cover` 与 `intro` 为空字符串。

## 测试数据清理

`book_stnh_001` ~ `book_stnh_003` 是占位测试数据（其中 `能源通识导论` 的 `author` 标了「测试数据」）。
正式上线前按需在控制台删除或改成真实藏书。

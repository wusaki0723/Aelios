/**
 * notion-mcp.js - Notion集成工具
 * 
 * 功能：
 * - Notion API调用封装
 * - 数据库同步
 * - 页面创建和更新
 * - 块内容操作
 * 
 * 需要先获取Notion Integration Token:
 * https://www.notion.so/my-integrations
 * 
 * @author Love Phone App
 * @version 1.0.0
 */

// ============================================
// Notion API 配置常量
// ============================================

/**
 * Notion API 基础URL
 */
const NOTION_API_BASE = 'https://api.notion.com/v1';

/**
 * Notion API 版本
 */
const NOTION_API_VERSION = '2022-06-28';

/**
 * 默认数据库配置
 */
export const DEFAULT_DATABASE_SCHEMA = {
  // 日记数据库
  diary: {
    title: { title: {} },
    date: { date: {} },
    mood: { select: { options: [
      { name: '开心', color: 'yellow' },
      { name: '平静', color: 'green' },
      { name: '难过', color: 'blue' },
      { name: '生气', color: 'red' },
      { name: '兴奋', color: 'orange' },
      { name: '疲惫', color: 'gray' }
    ]}},
    tags: { multi_select: { options: [] } },
    content: { rich_text: {} }
  },
  // 记账数据库
  expenses: {
    item: { title: {} },
    date: { date: {} },
    amount: { number: { format: 'yuan' } },
    category: { select: { options: [
      { name: '餐饮', color: 'orange' },
      { name: '交通', color: 'blue' },
      { name: '购物', color: 'pink' },
      { name: '娱乐', color: 'purple' },
      { name: '礼物', color: 'red' },
      { name: '旅行', color: 'green' },
      { name: '其他', color: 'gray' }
    ]}},
    type: { select: { options: [
      { name: '支出', color: 'red' },
      { name: '收入', color: 'green' }
    ]}},
    note: { rich_text: {} }
  },
  // 纪念日数据库
  anniversaries: {
    name: { title: {} },
    date: { date: {} },
    category: { select: { options: [
      { name: '相识', color: 'blue' },
      { name: '恋爱', color: 'red' },
      { name: '结婚', color: 'purple' },
      { name: '生日', color: 'yellow' },
      { name: '其他', color: 'gray' }
    ]}},
    reminder: { checkbox: {} },
    days_count: { number: {} },
    note: { rich_text: {} }
  },
  // 任务数据库
  tasks: {
    title: { title: {} },
    created_date: { date: {} },
    due_date: { date: {} },
    status: { select: { options: [
      { name: '待办', color: 'gray' },
      { name: '进行中', color: 'yellow' },
      { name: '已完成', color: 'green' },
      { name: '已取消', color: 'red' }
    ]}},
    priority: { select: { options: [
      { name: '高', color: 'red' },
      { name: '中', color: 'yellow' },
      { name: '低', color: 'green' }
    ]}},
    assignee: { people: {} },
    note: { rich_text: {} }
  },
  // 记忆库数据库
  memories: {
    title: { title: {} },
    date: { date: {} },
    location: { rich_text: {} },
    category: { select: { options: [
      { name: '旅行', color: 'green' },
      { name: '约会', color: 'pink' },
      { name: '节日', color: 'purple' },
      { name: '日常', color: 'blue' },
      { name: '重要时刻', color: 'red' }
    ]}},
    mood: { select: { options: [
      { name: '开心', color: 'yellow' },
      { name: '感动', color: 'orange' },
      { name: '浪漫', color: 'pink' },
      { name: '难忘', color: 'purple' }
    ]}},
    description: { rich_text: {} },
    photos: { files: {} }
  }
};

// ============================================
// Notion API 错误类
// ============================================

/**
 * Notion API错误类
 */
export class NotionAPIError extends Error {
  constructor(message, code = null, status = null, details = null) {
    super(message);
    this.name = 'NotionAPIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /**
   * 获取用户友好的错误消息
   * @returns {string} 错误消息
   */
  getUserMessage() {
    const messages = {
      'unauthorized': 'Notion授权失败，请检查Token',
      'restricted_resource': '没有访问权限，请确保页面已共享给Integration',
      'object_not_found': '找不到指定的页面或数据库',
      'validation_error': '数据格式错误，请检查输入',
      'rate_limited': '请求太频繁，请稍后再试',
      'internal_server_error': 'Notion服务暂时不可用'
    };
    
    return messages[this.code] || this.message || 'Notion操作失败';
  }
}

// ============================================
// Notion API 客户端
// ============================================

/**
 * Notion API 客户端
 * 封装所有Notion API调用
 */
export class NotionClient {
  /**
   * 创建NotionClient实例
   * @param {Object} config - 配置
   * @param {string} config.token - Notion Integration Token
   * @param {number} config.timeout - 请求超时时间（毫秒）
   * @param {number} config.maxRetries - 最大重试次数
   */
  constructor(config = {}) {
    this.token = config.token || '';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
  }

  /**
   * 更新配置
   * @param {Object} config - 新配置
   */
  updateConfig(config) {
    Object.assign(this, config);
  }

  /**
   * 设置Token
   * @param {string} token - Notion Integration Token
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * 测试API连接
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection() {
    try {
      // 尝试获取用户信息来验证token
      const response = await this._makeRequest('/users/me');
      
      return {
        success: true,
        message: '连接成功',
        user: response
      };
    } catch (error) {
      return {
        success: false,
        message: error.getUserMessage(),
        error: error.code
      };
    }
  }

  // ============================================
  // 页面操作
  // ============================================

  /**
   * 获取页面信息
   * @param {string} pageId - 页面ID
   * @returns {Promise<Object>} 页面信息
   */
  async getPage(pageId) {
    return this._makeRequest(`/pages/${pageId}`);
  }

  /**
   * 创建页面
   * @param {Object} params - 创建参数
   * @param {string} params.parent - 父页面或数据库ID
   * @param {Object} params.properties - 页面属性
   * @param {Array} params.children - 页面内容块
   * @returns {Promise<Object>} 创建的页面
   */
  async createPage({ parent, properties, children = [] }) {
    const body = {
      parent,
      properties
    };

    if (children.length > 0) {
      body.children = children;
    }

    return this._makeRequest('/pages', 'POST', body);
  }

  /**
   * 更新页面
   * @param {string} pageId - 页面ID
   * @param {Object} properties - 更新的属性
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 更新后的页面
   */
  async updatePage(pageId, properties, options = {}) {
    const body = { properties };
    
    if (options.archived !== undefined) {
      body.archived = options.archived;
    }

    if (options.icon) {
      body.icon = options.icon;
    }

    if (options.cover) {
      body.cover = options.cover;
    }

    return this._makeRequest(`/pages/${pageId}`, 'PATCH', body);
  }

  /**
   * 归档页面（软删除）
   * @param {string} pageId - 页面ID
   * @returns {Promise<Object>} 归档的页面
   */
  async archivePage(pageId) {
    return this.updatePage(pageId, {}, { archived: true });
  }

  // ============================================
  // 数据库操作
  // ============================================

  /**
   * 获取数据库信息
   * @param {string} databaseId - 数据库ID
   * @returns {Promise<Object>} 数据库信息
   */
  async getDatabase(databaseId) {
    return this._makeRequest(`/databases/${databaseId}`);
  }

  /**
   * 创建数据库
   * @param {Object} params - 创建参数
   * @param {string} params.parent - 父页面ID
   * @param {string} params.title - 数据库标题
   * @param {Object} params.properties - 数据库属性定义
   * @returns {Promise<Object>} 创建的数据库
   */
  async createDatabase({ parent, title, properties }) {
    const body = {
      parent: { page_id: parent },
      title: [{ type: 'text', text: { content: title } }],
      properties
    };

    return this._makeRequest('/databases', 'POST', body);
  }

  /**
   * 更新数据库
   * @param {string} databaseId - 数据库ID
   * @param {Object} params - 更新参数
   * @returns {Promise<Object>} 更新后的数据库
   */
  async updateDatabase(databaseId, { title, properties, description }) {
    const body = {};

    if (title) {
      body.title = [{ type: 'text', text: { content: title } }];
    }

    if (properties) {
      body.properties = properties;
    }

    if (description) {
      body.description = [{ type: 'text', text: { content: description } }];
    }

    return this._makeRequest(`/databases/${databaseId}`, 'PATCH', body);
  }

  /**
   * 查询数据库
   * @param {string} databaseId - 数据库ID
   * @param {Object} params - 查询参数
   * @returns {Promise<Object>} 查询结果
   */
  async queryDatabase(databaseId, params = {}) {
    const body = {};

    // 过滤器
    if (params.filter) {
      body.filter = params.filter;
    }

    // 排序
    if (params.sorts) {
      body.sorts = params.sorts;
    }

    // 分页
    if (params.start_cursor) {
      body.start_cursor = params.start_cursor;
    }

    if (params.page_size) {
      body.page_size = Math.min(params.page_size, 100);
    }

    return this._makeRequest(`/databases/${databaseId}/query`, 'POST', body);
  }

  /**
   * 获取数据库所有条目（自动分页）
   * @param {string} databaseId - 数据库ID
   * @param {Object} params - 查询参数
   * @returns {Promise<Array>} 所有条目
   */
  async getAllDatabaseEntries(databaseId, params = {}) {
    const allResults = [];
    let hasMore = true;
    let nextCursor = null;

    while (hasMore) {
      const response = await this.queryDatabase(databaseId, {
        ...params,
        start_cursor: nextCursor,
        page_size: 100
      });

      allResults.push(...response.results);
      hasMore = response.has_more;
      nextCursor = response.next_cursor;
    }

    return allResults;
  }

  // ============================================
  // 块操作
  // ============================================

  /**
   * 获取块的子块
   * @param {string} blockId - 块ID
   * @param {Object} params - 分页参数
   * @returns {Promise<Object>} 子块列表
   */
  async getBlockChildren(blockId, params = {}) {
    const queryParams = new URLSearchParams();
    
    if (params.start_cursor) {
      queryParams.append('start_cursor', params.start_cursor);
    }
    
    if (params.page_size) {
      queryParams.append('page_size', Math.min(params.page_size, 100));
    }

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return this._makeRequest(`/blocks/${blockId}/children${query}`);
  }

  /**
   * 追加块子项
   * @param {string} blockId - 块ID
   * @param {Array} children - 子块数组
   * @returns {Promise<Object>} 追加结果
   */
  async appendBlockChildren(blockId, children) {
    return this._makeRequest(
      `/blocks/${blockId}/children`,
      'PATCH',
      { children }
    );
  }

  /**
   * 更新块
   * @param {string} blockId - 块ID
   * @param {Object} updates - 更新内容
   * @returns {Promise<Object>} 更新后的块
   */
  async updateBlock(blockId, updates) {
    return this._makeRequest(`/blocks/${blockId}`, 'PATCH', updates);
  }

  /**
   * 删除块
   * @param {string} blockId - 块ID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteBlock(blockId) {
    return this._makeRequest(`/blocks/${blockId}`, 'DELETE');
  }

  // ============================================
  // 搜索操作
  // ============================================

  /**
   * 搜索页面和数据库
   * @param {Object} params - 搜索参数
   * @returns {Promise<Object>} 搜索结果
   */
   async search(params = {}) {
    const body = {};

    if (params.query) {
      body.query = params.query;
    }

    if (params.filter) {
      body.filter = params.filter;
    }

    if (params.sort) {
      body.sort = params.sort;
    }

    if (params.start_cursor) {
      body.start_cursor = params.start_cursor;
    }

    if (params.page_size) {
      body.page_size = Math.min(params.page_size, 100);
    }

    return this._makeRequest('/search', 'POST', body);
  }

  /**
   * 按标题搜索
   * @param {string} title - 标题关键词
   * @returns {Promise<Array>} 搜索结果
   */
  async searchByTitle(title) {
    const response = await this.search({ query: title });
    return response.results;
  }

  // ============================================
  // 用户操作
  // ============================================

  /**
   * 获取所有用户
   * @param {Object} params - 分页参数
   * @returns {Promise<Object>} 用户列表
   */
  async listUsers(params = {}) {
    const queryParams = new URLSearchParams();
    
    if (params.start_cursor) {
      queryParams.append('start_cursor', params.start_cursor);
    }
    
    if (params.page_size) {
      queryParams.append('page_size', Math.min(params.page_size, 100));
    }

    const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
    return this._makeRequest(`/users${query}`);
  }

  /**
   * 获取用户信息
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} 用户信息
   */
  async getUser(userId) {
    return this._makeRequest(`/users/${userId}`);
  }

  /**
   * 获取当前用户信息
   * @returns {Promise<Object>} 当前用户信息
   */
  async getCurrentUser() {
    return this._makeRequest('/users/me');
  }

  // ============================================
  // 内部方法
  // ============================================

  /**
   * 发送API请求
   * @param {string} endpoint - API端点
   * @param {string} method - HTTP方法
   * @param {Object} body - 请求体
   * @param {number} retryCount - 当前重试次数
   * @returns {Promise<Object>} 响应结果
   * @private
   */
  async _makeRequest(endpoint, method = 'GET', body = null, retryCount = 0) {
    const url = `${NOTION_API_BASE}${endpoint}`;
    
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        // 处理特定错误
        if (response.status === 429 && retryCount < this.maxRetries) {
          // 速率限制，等待后重试
          await this._delay(this.retryDelay * (retryCount + 1));
          return this._makeRequest(endpoint, method, body, retryCount + 1);
        }

        throw new NotionAPIError(
          data.message || `HTTP ${response.status}`,
          data.code,
          response.status,
          data
        );
      }

      return data;

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new NotionAPIError('请求超时', 'timeout_error');
      }

      if (error instanceof NotionAPIError) {
        throw error;
      }

      // 网络错误，尝试重试
      if (retryCount < this.maxRetries) {
        await this._delay(this.retryDelay);
        return this._makeRequest(endpoint, method, body, retryCount + 1);
      }

      throw new NotionAPIError(error.message, 'network_error');
    }
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================
// 数据库同步管理器
// ============================================

/**
 * 数据库同步管理器
 * 管理本地数据与Notion数据库的同步
 */
export class DatabaseSyncManager {
  /**
   * 创建同步管理器实例
   * @param {NotionClient} client - NotionClient实例
   * @param {Object} mappings - 数据库ID映射
   */
  constructor(client, mappings = {}) {
    this.client = client;
    this.databaseIds = mappings;
    this.syncStatus = new Map();
  }

  /**
   * 设置数据库ID映射
   * @param {Object} mappings - 数据库ID映射
   */
  setDatabaseIds(mappings) {
    this.databaseIds = { ...this.databaseIds, ...mappings };
  }

  /**
   * 初始化数据库
   * 在Notion中创建应用需要的所有数据库
   * @param {string} parentPageId - 父页面ID
   * @returns {Promise<Object>} 创建的数据库ID映射
   */
  async initializeDatabases(parentPageId) {
    const createdDatabases = {};

    for (const [name, schema] of Object.entries(DEFAULT_DATABASE_SCHEMA)) {
      try {
        const database = await this.client.createDatabase({
          parent: parentPageId,
          title: `恋爱小手机 - ${this._getChineseName(name)}`,
          properties: schema
        });

        createdDatabases[name] = database.id;
        console.log(`Created database: ${name} (${database.id})`);
      } catch (error) {
        console.error(`Failed to create database ${name}:`, error);
      }
    }

    this.setDatabaseIds(createdDatabases);
    return createdDatabases;
  }

  /**
   * 同步日记条目
   * @param {Array} entries - 日记条目数组
   * @returns {Promise<Object>} 同步结果
   */
  async syncDiaryEntries(entries) {
    const databaseId = this.databaseIds.diary;
    if (!databaseId) {
      throw new NotionAPIError('日记数据库未配置', 'config_error');
    }

    const results = { created: 0, updated: 0, failed: 0 };

    for (const entry of entries) {
      try {
        // 检查是否已存在
        const existing = await this._findExistingEntry(
          databaseId,
          'title',
          entry.title
        );

        const properties = this._buildDiaryProperties(entry);

        if (existing) {
          // 更新现有条目
          await this.client.updatePage(existing.id, properties);
          results.updated++;
        } else {
          // 创建新条目
          await this.client.createPage({
            parent: { database_id: databaseId },
            properties
          });
          results.created++;
        }
      } catch (error) {
        console.error('Failed to sync diary entry:', error);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * 同步记账数据
   * @param {Array} expenses - 记账数据数组
   * @returns {Promise<Object>} 同步结果
   */
  async syncExpenses(expenses) {
    const databaseId = this.databaseIds.expenses;
    if (!databaseId) {
      throw new NotionAPIError('记账数据库未配置', 'config_error');
    }

    const results = { created: 0, updated: 0, failed: 0 };

    for (const expense of expenses) {
      try {
        const existing = await this._findExistingEntry(
          databaseId,
          'item',
          expense.item,
          { date: { equals: expense.date } }
        );

        const properties = this._buildExpenseProperties(expense);

        if (existing) {
          await this.client.updatePage(existing.id, properties);
          results.updated++;
        } else {
          await this.client.createPage({
            parent: { database_id: databaseId },
            properties
          });
          results.created++;
        }
      } catch (error) {
        console.error('Failed to sync expense:', error);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * 同步纪念日
   * @param {Array} anniversaries - 纪念日数组
   * @returns {Promise<Object>} 同步结果
   */
  async syncAnniversaries(anniversaries) {
    const databaseId = this.databaseIds.anniversaries;
    if (!databaseId) {
      throw new NotionAPIError('纪念日数据库未配置', 'config_error');
    }

    const results = { created: 0, updated: 0, failed: 0 };

    for (const anniversary of anniversaries) {
      try {
        const existing = await this._findExistingEntry(
          databaseId,
          'name',
          anniversary.name
        );

        const properties = this._buildAnniversaryProperties(anniversary);

        if (existing) {
          await this.client.updatePage(existing.id, properties);
          results.updated++;
        } else {
          await this.client.createPage({
            parent: { database_id: databaseId },
            properties
          });
          results.created++;
        }
      } catch (error) {
        console.error('Failed to sync anniversary:', error);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * 同步任务
   * @param {Array} tasks - 任务数组
   * @returns {Promise<Object>} 同步结果
   */
  async syncTasks(tasks) {
    const databaseId = this.databaseIds.tasks;
    if (!databaseId) {
      throw new NotionAPIError('任务数据库未配置', 'config_error');
    }

    const results = { created: 0, updated: 0, failed: 0 };

    for (const task of tasks) {
      try {
        const existing = task.notionPageId 
          ? { id: task.notionPageId }
          : null;

        const properties = this._buildTaskProperties(task);

        if (existing) {
          await this.client.updatePage(existing.id, properties);
          results.updated++;
        } else {
          const page = await this.client.createPage({
            parent: { database_id: databaseId },
            properties
          });
          // 保存Notion页面ID到本地
          task.notionPageId = page.id;
          results.created++;
        }
      } catch (error) {
        console.error('Failed to sync task:', error);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * 同步记忆库
   * @param {Array} memories - 记忆数组
   * @returns {Promise<Object>} 同步结果
   */
  async syncMemories(memories) {
    const databaseId = this.databaseIds.memories;
    if (!databaseId) {
      throw new NotionAPIError('记忆库数据库未配置', 'config_error');
    }

    const results = { created: 0, updated: 0, failed: 0 };

    for (const memory of memories) {
      try {
        const existing = await this._findExistingEntry(
          databaseId,
          'title',
          memory.title,
          { date: { equals: memory.date } }
        );

        const properties = this._buildMemoryProperties(memory);

        if (existing) {
          await this.client.updatePage(existing.id, properties);
          results.updated++;
        } else {
          await this.client.createPage({
            parent: { database_id: databaseId },
            properties
          });
          results.created++;
        }
      } catch (error) {
        console.error('Failed to sync memory:', error);
        results.failed++;
      }
    }

    return results;
  }

  /**
   * 全量同步
   * @param {Object} data - 所有本地数据
   * @returns {Promise<Object>} 同步结果
   */
  async fullSync(data) {
    const results = {};

    if (data.diaryEntries) {
      results.diary = await this.syncDiaryEntries(data.diaryEntries);
    }

    if (data.expenses) {
      results.expenses = await this.syncExpenses(data.expenses);
    }

    if (data.anniversaries) {
      results.anniversaries = await this.syncAnniversaries(data.anniversaries);
    }

    if (data.tasks) {
      results.tasks = await this.syncTasks(data.tasks);
    }

    if (data.memories) {
      results.memories = await this.syncMemories(data.memories);
    }

    return results;
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 查找已存在的条目
   * @param {string} databaseId - 数据库ID
   * @param {string} propertyName - 属性名
   * @param {string} propertyValue - 属性值
   * @param {Object} additionalFilter - 额外过滤条件
   * @returns {Promise<Object|null>} 找到的条目或null
   * @private
   */
  async _findExistingEntry(databaseId, propertyName, propertyValue, additionalFilter = null) {
    const filter = {
      property: propertyName,
      title: { equals: propertyValue }
    };

    if (additionalFilter) {
      filter.and = [filter, additionalFilter];
    }

    const response = await this.client.queryDatabase(databaseId, {
      filter,
      page_size: 1
    });

    return response.results[0] || null;
  }

  /**
   * 构建日记属性
   * @param {Object} entry - 日记条目
   * @returns {Object} Notion属性
   * @private
   */
  _buildDiaryProperties(entry) {
    return {
      title: { title: [{ text: { content: entry.title || '无标题' } }] },
      date: { date: { start: entry.date || new Date().toISOString().split('T')[0] } },
      mood: { select: { name: entry.mood || '平静' } },
      tags: { multi_select: (entry.tags || []).map(tag => ({ name: tag })) },
      content: { rich_text: [{ text: { content: entry.content || '' } }] }
    };
  }

  /**
   * 构建记账属性
   * @param {Object} expense - 记账数据
   * @returns {Object} Notion属性
   * @private
   */
  _buildExpenseProperties(expense) {
    return {
      item: { title: [{ text: { content: expense.item } }] },
      date: { date: { start: expense.date } },
      amount: { number: expense.amount },
      category: { select: { name: expense.category || '其他' } },
      type: { select: { name: expense.type || '支出' } },
      note: { rich_text: [{ text: { content: expense.note || '' } }] }
    };
  }

  /**
   * 构建纪念日属性
   * @param {Object} anniversary - 纪念日数据
   * @returns {Object} Notion属性
   * @private
   */
  _buildAnniversaryProperties(anniversary) {
    return {
      name: { title: [{ text: { content: anniversary.name } }] },
      date: { date: { start: anniversary.date } },
      category: { select: { name: anniversary.category || '其他' } },
      reminder: { checkbox: anniversary.reminder || false },
      days_count: { number: anniversary.daysCount || 0 },
      note: { rich_text: [{ text: { content: anniversary.note || '' } }] }
    };
  }

  /**
   * 构建任务属性
   * @param {Object} task - 任务数据
   * @returns {Object} Notion属性
   * @private
   */
  _buildTaskProperties(task) {
    return {
      title: { title: [{ text: { content: task.title } }] },
      created_date: { date: { start: task.createdDate || new Date().toISOString().split('T')[0] } },
      due_date: task.dueDate ? { date: { start: task.dueDate } } : undefined,
      status: { select: { name: task.status || '待办' } },
      priority: { select: { name: task.priority || '中' } },
      note: { rich_text: [{ text: { content: task.note || '' } }] }
    };
  }

  /**
   * 构建记忆属性
   * @param {Object} memory - 记忆数据
   * @returns {Object} Notion属性
   * @private
   */
  _buildMemoryProperties(memory) {
    return {
      title: { title: [{ text: { content: memory.title } }] },
      date: { date: { start: memory.date } },
      location: { rich_text: [{ text: { content: memory.location || '' } }] },
      category: { select: { name: memory.category || '日常' } },
      mood: { select: { name: memory.mood || '开心' } },
      description: { rich_text: [{ text: { content: memory.description || '' } }] }
    };
  }

  /**
   * 获取中文名称
   * @param {string} name - 英文名
   * @returns {string} 中文名
   * @private
   */
  _getChineseName(name) {
    const names = {
      diary: '日记',
      expenses: '记账',
      anniversaries: '纪念日',
      tasks: '任务',
      memories: '记忆库'
    };
    return names[name] || name;
  }
}

// ============================================
// 块构建器
// ============================================

/**
 * Notion块构建器
 * 用于快速创建各种Notion块
 */
export class BlockBuilder {
  /**
   * 创建段落块
   * @param {string} text - 文本内容
   * @param {Object} options - 选项
   * @returns {Object} 段落块
   */
  static paragraph(text, options = {}) {
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: text } }],
        color: options.color || 'default'
      }
    };
  }

  /**
   * 创建标题块
   * @param {string} text - 标题文本
   * @param {number} level - 标题级别（1-3）
   * @returns {Object} 标题块
   */
  static heading(text, level = 1) {
    const type = `heading_${level}`;
    return {
      object: 'block',
      type,
      [type]: {
        rich_text: [{ type: 'text', text: { content: text } }]
      }
    };
  }

  /**
   * 创建列表项块
   * @param {string} text - 列表项文本
   * @param {string} type - 列表类型（bulleted/numbered/to_do）
   * @param {boolean} checked - 是否已勾选（仅to_do）
   * @returns {Object} 列表块
   */
  static listItem(text, type = 'bulleted', checked = false) {
    const blockType = `${type}_list_item`;
    const block = {
      object: 'block',
      type: blockType,
      [blockType]: {
        rich_text: [{ type: 'text', text: { content: text } }]
      }
    };

    if (type === 'to_do') {
      block[blockType].checked = checked;
    }

    return block;
  }

  /**
   * 创建引用块
   * @param {string} text - 引用文本
   * @returns {Object} 引用块
   */
  static quote(text) {
    return {
      object: 'block',
      type: 'quote',
      quote: {
        rich_text: [{ type: 'text', text: { content: text } }]
      }
    };
  }

  /**
   * 创建代码块
   * @param {string} code - 代码内容
   * @param {string} language - 编程语言
   * @returns {Object} 代码块
   */
  static code(code, language = 'plain text') {
    return {
      object: 'block',
      type: 'code',
      code: {
        rich_text: [{ type: 'text', text: { content: code } }],
        language
      }
    };
  }

  /**
   * 创建分隔线块
   * @returns {Object} 分隔线块
   */
  static divider() {
    return {
      object: 'block',
      type: 'divider',
      divider: {}
    };
  }

  /**
   * 创建图片块
   * @param {string} url - 图片URL
   * @param {string} caption - 图片说明
   * @returns {Object} 图片块
   */
  static image(url, caption = '') {
    return {
      object: 'block',
      type: 'image',
      image: {
        type: 'external',
        external: { url },
        caption: caption ? [{ type: 'text', text: { content: caption } }] : []
      }
    };
  }

  /**
   * 创建书签块
   * @param {string} url - 书签URL
   * @returns {Object} 书签块
   */
  static bookmark(url) {
    return {
      object: 'block',
      type: 'bookmark',
      bookmark: { url }
    };
  }

  /**
   * 创建表格块
   * @param {Array[]} rows - 表格数据（二维数组）
   * @returns {Object[]} 表格块数组
   */
  static table(rows) {
    if (!rows || rows.length === 0) return [];

    const tableWidth = rows[0].length;
    const tableChildren = rows.map(row => ({
      object: 'block',
      type: 'table_row',
      table_row: {
        cells: row.map(cell => [{ type: 'text', text: { content: String(cell) } }])
      }
    }));

    return [{
      object: 'block',
      type: 'table',
      table: {
        table_width: tableWidth,
        has_column_header: true,
        has_row_header: false,
        children: tableChildren
      }
    }];
  }

  /**
   * 创建折叠块
   * @param {string} title - 折叠标题
   * @param {Array} children - 子块数组
   * @returns {Object} 折叠块
   */
  static toggle(title, children = []) {
    return {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [{ type: 'text', text: { content: title } }],
        children
      }
    };
  }

  /**
   * 创建标注块
   * @param {string} text - 标注文本
   * @param {string} icon - 图标emoji
   * @param {string} color - 颜色
   * @returns {Object} 标注块
   */
  static callout(text, icon = '💡', color = 'blue_background') {
    return {
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ type: 'text', text: { content: text } }],
        icon: { type: 'emoji', emoji: icon },
        color
      }
    };
  }
}

// ============================================
// 便捷函数
// ============================================

/**
 * 创建Notion客户端
 * @param {Object} config - 配置
 * @returns {NotionClient} NotionClient实例
 */
export function createNotionClient(config = {}) {
  return new NotionClient(config);
}

/**
 * 创建同步管理器
 * @param {NotionClient} client - NotionClient实例
 * @param {Object} mappings - 数据库ID映射
 * @returns {DatabaseSyncManager} DatabaseSyncManager实例
 */
export function createSyncManager(client, mappings = {}) {
  return new DatabaseSyncManager(client, mappings);
}

/**
 * 快速创建页面
 * @param {string} token - Notion Token
 * @param {string} parentId - 父页面ID
 * @param {string} title - 页面标题
 * @param {Array} content - 页面内容块
 * @returns {Promise<Object>} 创建的页面
 */
export async function quickCreatePage(token, parentId, title, content = []) {
  const client = createNotionClient({ token });
  
  return client.createPage({
    parent: { page_id: parentId },
    properties: {
      title: { title: [{ text: { content: title } }] }
    },
    children: content
  });
}

/**
 * 快速查询数据库
 * @param {string} token - Notion Token
 * @param {string} databaseId - 数据库ID
 * @param {Object} filter - 过滤条件
 * @returns {Promise<Array>} 查询结果
 */
export async function quickQueryDatabase(token, databaseId, filter = null) {
  const client = createNotionClient({ token });
  
  const response = await client.queryDatabase(databaseId, { filter });
  return response.results;
}

// ============================================
// 默认导出
// ============================================

export default {
  NOTION_API_BASE,
  NOTION_API_VERSION,
  DEFAULT_DATABASE_SCHEMA,
  NotionAPIError,
  NotionClient,
  DatabaseSyncManager,
  BlockBuilder,
  createNotionClient,
  createSyncManager,
  quickCreatePage,
  quickQueryDatabase
};

/**
 * storage.js - 本地存储封装工具
 * 
 * 功能：
 * - localStorage的封装，支持对象存储
 * - 数据加密/解密（可选）
 * - 存储键名统一管理
 * - 数据迁移和清理
 * 
 * @author Love Phone App
 * @version 1.0.0
 */

// ============================================
// 存储键名统一管理
// ============================================

/**
 * 存储键名常量
 * 所有本地存储的键名都定义在这里，便于统一管理
 */
export const STORAGE_KEYS = {
  CONFIG: 'love_config',                    // 应用配置
  CHAT_HISTORY: 'love_chat_history',        // 聊天记录
  DIARY_ENTRIES: 'love_diary_entries',      // 日记条目
  EXPENSES: 'love_expenses',                // 记账数据
  HEALTH_CYCLES: 'love_health_cycles',      // 健康周期数据
  MEMORIES: 'love_memories',                // 记忆库
  BLINDBOX_INVENTORY: 'love_blindbox_inventory', // 盲盒库存
  CHECKIN_STREAK: 'love_checkin_streak',    // 连续签到
  TASKS: 'love_tasks',                      // 任务列表
  SETTINGS: 'love_settings',                // 用户设置
  USER_PROFILE: 'love_user_profile',        // 用户资料
  PARTNER_PROFILE: 'love_partner_profile',  // 伴侣资料
  ANNIVERSARIES: 'love_anniversaries',      // 纪念日
  LAST_SYNC: 'love_last_sync'               // 最后同步时间
};

// ============================================
// 简单加密工具（Base64 + 混淆）
// ============================================

/**
 * 简单的加密类
 * 注意：这不是真正的加密，只是对数据进行混淆
 * 如需真正安全，请使用专业的加密库
 */
class SimpleCrypto {
  constructor(secretKey = 'love-phone-default-key') {
    this.secretKey = secretKey;
  }

  /**
   * 加密数据
   * @param {string} data - 要加密的数据
   * @returns {string} 加密后的数据
   */
  encrypt(data) {
    try {
      // 将数据和密钥混合后进行Base64编码
      const mixed = this._xorWithKey(data, this.secretKey);
      return btoa(mixed);
    } catch (error) {
      console.error('Encryption failed:', error);
      return data;
    }
  }

  /**
   * 解密数据
   * @param {string} encryptedData - 加密的数据
   * @returns {string} 解密后的数据
   */
  decrypt(encryptedData) {
    try {
      const mixed = atob(encryptedData);
      return this._xorWithKey(mixed, this.secretKey);
    } catch (error) {
      console.error('Decryption failed:', error);
      return encryptedData;
    }
  }

  /**
   * XOR加密
   * @param {string} data - 数据
   * @param {string} key - 密钥
   * @returns {string} 处理后的数据
   * @private
   */
  _xorWithKey(data, key) {
    let result = '';
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(
        data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      );
    }
    return result;
  }
}

// ============================================
// 存储管理器类
// ============================================

/**
 * 存储管理器
 * 封装localStorage操作，支持对象存储和可选加密
 */
export class StorageManager {
  /**
   * 创建存储管理器实例
   * @param {Object} options - 配置选项
   * @param {boolean} options.encrypt - 是否启用加密
   * @param {string} options.secretKey - 加密密钥
   * @param {string} options.prefix - 键名前缀
   */
  constructor(options = {}) {
    this.encrypt = options.encrypt || false;
    this.prefix = options.prefix || '';
    this.crypto = this.encrypt 
      ? new SimpleCrypto(options.secretKey) 
      : null;
    
    // 检查localStorage可用性
    this._checkAvailability();
  }

  /**
   * 检查localStorage是否可用
   * @private
   */
  _checkAvailability() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      this.isAvailable = true;
    } catch (e) {
      this.isAvailable = false;
      console.warn('localStorage is not available');
    }
  }

  /**
   * 获取完整的键名（带前缀）
   * @param {string} key - 原始键名
   * @returns {string} 完整键名
   * @private
   */
  _getFullKey(key) {
    return this.prefix ? `${this.prefix}_${key}` : key;
  }

  /**
   * 存储数据
   * @param {string} key - 键名
   * @param {*} value - 要存储的数据（任意类型）
   * @returns {boolean} 是否成功
   */
  set(key, value) {
    if (!this.isAvailable) {
      console.warn('Storage is not available');
      return false;
    }

    try {
      const fullKey = this._getFullKey(key);
      
      // 将数据序列化为JSON字符串
      let data = JSON.stringify({
        value,
        timestamp: Date.now(),
        version: '1.0'
      });

      // 如果需要加密
      if (this.encrypt && this.crypto) {
        data = this.crypto.encrypt(data);
      }

      localStorage.setItem(fullKey, data);
      return true;
    } catch (error) {
      console.error('Storage set error:', error);
      
      // 如果是存储空间不足
      if (error.name === 'QuotaExceededError') {
        this._handleQuotaExceeded();
      }
      
      return false;
    }
  }

  /**
   * 获取数据
   * @param {string} key - 键名
   * @param {*} defaultValue - 默认值
   * @returns {*} 存储的数据或默认值
   */
  get(key, defaultValue = null) {
    if (!this.isAvailable) {
      return defaultValue;
    }

    try {
      const fullKey = this._getFullKey(key);
      let data = localStorage.getItem(fullKey);

      if (data === null) {
        return defaultValue;
      }

      // 如果需要解密
      if (this.encrypt && this.crypto) {
        data = this.crypto.decrypt(data);
      }

      const parsed = JSON.parse(data);
      return parsed.value;
    } catch (error) {
      console.error('Storage get error:', error);
      return defaultValue;
    }
  }

  /**
   * 移除数据
   * @param {string} key - 键名
   * @returns {boolean} 是否成功
   */
  remove(key) {
    if (!this.isAvailable) {
      return false;
    }

    try {
      const fullKey = this._getFullKey(key);
      localStorage.removeItem(fullKey);
      return true;
    } catch (error) {
      console.error('Storage remove error:', error);
      return false;
    }
  }

  /**
   * 检查键是否存在
   * @param {string} key - 键名
   * @returns {boolean} 是否存在
   */
  has(key) {
    if (!this.isAvailable) {
      return false;
    }

    const fullKey = this._getFullKey(key);
    return localStorage.getItem(fullKey) !== null;
  }

  /**
   * 获取所有键名
   * @returns {string[]} 键名数组
   */
  keys() {
    if (!this.isAvailable) {
      return [];
    }

    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (this.prefix) {
        if (key.startsWith(`${this.prefix}_`)) {
          keys.push(key.slice(this.prefix.length + 1));
        }
      } else {
        keys.push(key);
      }
    }
    return keys;
  }

  /**
   * 清空所有数据
   * @param {boolean} onlyPrefixed - 是否只清除带前缀的数据
   * @returns {boolean} 是否成功
   */
  clear(onlyPrefixed = true) {
    if (!this.isAvailable) {
      return false;
    }

    try {
      if (onlyPrefixed && this.prefix) {
        // 只清除带前缀的数据
        const keysToRemove = this.keys();
        keysToRemove.forEach(key => this.remove(key));
      } else {
        // 清除所有数据
        localStorage.clear();
      }
      return true;
    } catch (error) {
      console.error('Storage clear error:', error);
      return false;
    }
  }

  /**
   * 获取存储大小（字节）
   * @returns {number} 存储大小
   */
  getSize() {
    if (!this.isAvailable) {
      return 0;
    }

    let size = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      size += key.length + value.length;
    }
    return size * 2; // UTF-16编码，每个字符2字节
  }

  /**
   * 处理存储空间不足
   * @private
   */
  _handleQuotaExceeded() {
    console.warn('Storage quota exceeded, attempting cleanup...');
    
    // 尝试清理过期数据
    this._cleanupExpiredData();
    
    // 如果还是超出，清理最旧的数据
    if (this.getSize() > 4.5 * 1024 * 1024) { // 接近5MB限制
      this._cleanupOldestData();
    }
  }

  /**
   * 清理过期数据
   * @private
   */
  _cleanupExpiredData() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      try {
        let data = localStorage.getItem(key);
        if (this.encrypt && this.crypto) {
          data = this.crypto.decrypt(data);
        }
        const parsed = JSON.parse(data);
        
        if (parsed.timestamp && parsed.timestamp < thirtyDaysAgo) {
          localStorage.removeItem(key);
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

  /**
   * 清理最旧的数据
   * @private
   */
  _cleanupOldestData() {
    const items = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      try {
        let data = localStorage.getItem(key);
        if (this.encrypt && this.crypto) {
          data = this.crypto.decrypt(data);
        }
        const parsed = JSON.parse(data);
        items.push({ key, timestamp: parsed.timestamp || 0 });
      } catch (e) {
        items.push({ key, timestamp: 0 });
      }
    }
    
    // 按时间戳排序，删除最旧的20%
    items.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = Math.ceil(items.length * 0.2);
    
    for (let i = 0; i < toDelete; i++) {
      localStorage.removeItem(items[i].key);
    }
  }
}

// ============================================
// 数据迁移工具
// ============================================

/**
 * 数据迁移工具
 * 用于处理不同版本之间的数据迁移
 */
export class DataMigration {
  constructor(storageManager) {
    this.storage = storageManager;
    this.migrations = new Map();
  }

  /**
   * 注册迁移函数
   * @param {string} fromVersion - 起始版本
   * @param {string} toVersion - 目标版本
   * @param {Function} migrationFn - 迁移函数
   */
  register(fromVersion, toVersion, migrationFn) {
    const key = `${fromVersion}->${toVersion}`;
    this.migrations.set(key, migrationFn);
  }

  /**
   * 执行迁移
   * @param {string} fromVersion - 起始版本
   * @param {string} toVersion - 目标版本
   * @returns {boolean} 是否成功
   */
  async migrate(fromVersion, toVersion) {
    const key = `${fromVersion}->${toVersion}`;
    const migrationFn = this.migrations.get(key);
    
    if (!migrationFn) {
      console.warn(`No migration found from ${fromVersion} to ${toVersion}`);
      return false;
    }

    try {
      await migrationFn(this.storage);
      console.log(`Migration ${key} completed successfully`);
      return true;
    } catch (error) {
      console.error(`Migration ${key} failed:`, error);
      return false;
    }
  }

  /**
   * 检查并执行必要的迁移
   * @param {string} currentVersion - 当前应用版本
   */
  async checkAndMigrate(currentVersion) {
    const storedVersion = this.storage.get('app_version', '1.0.0');
    
    if (storedVersion === currentVersion) {
      return;
    }

    console.log(`Migrating from ${storedVersion} to ${currentVersion}`);
    
    // 执行迁移
    await this.migrate(storedVersion, currentVersion);
    
    // 更新版本号
    this.storage.set('app_version', currentVersion);
  }
}

// ============================================
// 便捷的数据访问方法
// ============================================

/**
 * 创建默认的存储管理器实例
 */
export const storage = new StorageManager({
  encrypt: false,
  prefix: 'love'
});

/**
 * 带加密的存储管理器实例
 */
export const secureStorage = new StorageManager({
  encrypt: true,
  secretKey: 'love-phone-secure-key-2024',
  prefix: 'love_secure'
});

/**
 * 便捷方法：获取配置
 * @returns {Object} 配置对象
 */
export function getConfig() {
  return storage.get(STORAGE_KEYS.CONFIG, {
    theme: 'default',
    language: 'zh-CN',
    notifications: true,
    sound: true
  });
}

/**
 * 便捷方法：保存配置
 * @param {Object} config - 配置对象
 */
export function setConfig(config) {
  return storage.set(STORAGE_KEYS.CONFIG, config);
}

/**
 * 便捷方法：获取聊天记录
 * @returns {Array} 聊天记录数组
 */
export function getChatHistory() {
  return storage.get(STORAGE_KEYS.CHAT_HISTORY, []);
}

/**
 * 便捷方法：保存聊天记录
 * @param {Array} history - 聊天记录数组
 */
export function setChatHistory(history) {
  return storage.set(STORAGE_KEYS.CHAT_HISTORY, history);
}

/**
 * 便捷方法：添加单条聊天记录
 * @param {Object} message - 消息对象
 */
export function addChatMessage(message) {
  const history = getChatHistory();
  history.push({
    ...message,
    id: Date.now().toString(36),
    timestamp: Date.now()
  });
  
  // 限制聊天记录数量，最多保留500条
  if (history.length > 500) {
    history.shift();
  }
  
  return setChatHistory(history);
}

/**
 * 便捷方法：获取日记条目
 * @returns {Array} 日记条目数组
 */
export function getDiaryEntries() {
  return storage.get(STORAGE_KEYS.DIARY_ENTRIES, []);
}

/**
 * 便捷方法：保存日记条目
 * @param {Array} entries - 日记条目数组
 */
export function setDiaryEntries(entries) {
  return storage.set(STORAGE_KEYS.DIARY_ENTRIES, entries);
}

/**
 * 便捷方法：获取记账数据
 * @returns {Array} 记账数据数组
 */
export function getExpenses() {
  return storage.get(STORAGE_KEYS.EXPENSES, []);
}

/**
 * 便捷方法：保存记账数据
 * @param {Array} expenses - 记账数据数组
 */
export function setExpenses(expenses) {
  return storage.set(STORAGE_KEYS.EXPENSES, expenses);
}

/**
 * 便捷方法：获取健康周期数据
 * @returns {Object} 健康周期数据
 */
export function getHealthCycles() {
  return storage.get(STORAGE_KEYS.HEALTH_CYCLES, {
    cycles: [],
    predictions: []
  });
}

/**
 * 便捷方法：保存健康周期数据
 * @param {Object} data - 健康周期数据
 */
export function setHealthCycles(data) {
  return storage.set(STORAGE_KEYS.HEALTH_CYCLES, data);
}

/**
 * 便捷方法：获取记忆库
 * @returns {Array} 记忆数组
 */
export function getMemories() {
  return storage.get(STORAGE_KEYS.MEMORIES, []);
}

/**
 * 便捷方法：保存记忆库
 * @param {Array} memories - 记忆数组
 */
export function setMemories(memories) {
  return storage.set(STORAGE_KEYS.MEMORIES, memories);
}

/**
 * 便捷方法：获取盲盒库存
 * @returns {Object} 盲盒库存
 */
export function getBlindboxInventory() {
  return storage.get(STORAGE_KEYS.BLINDBOX_INVENTORY, {
    items: [],
    totalOpened: 0,
    rareCount: 0
  });
}

/**
 * 便捷方法：保存盲盒库存
 * @param {Object} inventory - 盲盒库存
 */
export function setBlindboxInventory(inventory) {
  return storage.set(STORAGE_KEYS.BLINDBOX_INVENTORY, inventory);
}

/**
 * 便捷方法：获取签到数据
 * @returns {Object} 签到数据
 */
export function getCheckinStreak() {
  return storage.get(STORAGE_KEYS.CHECKIN_STREAK, {
    currentStreak: 0,
    longestStreak: 0,
    lastCheckin: null,
    history: []
  });
}

/**
 * 便捷方法：保存签到数据
 * @param {Object} data - 签到数据
 */
export function setCheckinStreak(data) {
  return storage.set(STORAGE_KEYS.CHECKIN_STREAK, data);
}

/**
 * 便捷方法：获取任务列表
 * @returns {Array} 任务数组
 */
export function getTasks() {
  return storage.get(STORAGE_KEYS.TASKS, []);
}

/**
 * 便捷方法：保存任务列表
 * @param {Array} tasks - 任务数组
 */
export function setTasks(tasks) {
  return storage.set(STORAGE_KEYS.TASKS, tasks);
}

/**
 * 便捷方法：获取设置
 * @returns {Object} 设置对象
 */
export function getSettings() {
  return storage.get(STORAGE_KEYS.SETTINGS, {
    theme: 'default',
    fontSize: 'medium',
    reduceMotion: false,
    privacyMode: false
  });
}

/**
 * 便捷方法：保存设置
 * @param {Object} settings - 设置对象
 */
export function setSettings(settings) {
  return storage.set(STORAGE_KEYS.SETTINGS, settings);
}

/**
 * 导出所有数据（用于备份）
 * @returns {Object} 所有数据的JSON对象
 */
export function exportAllData() {
  const data = {};
  Object.values(STORAGE_KEYS).forEach(key => {
    data[key] = storage.get(key);
  });
  return data;
}

/**
 * 导入数据（用于恢复）
 * @param {Object} data - 要导入的数据
 * @returns {boolean} 是否成功
 */
export function importAllData(data) {
  try {
    Object.entries(data).forEach(([key, value]) => {
      if (Object.values(STORAGE_KEYS).includes(key)) {
        storage.set(key, value);
      }
    });
    return true;
  } catch (error) {
    console.error('Import failed:', error);
    return false;
  }
}

// ============================================
// 默认导出
// ============================================

export default {
  STORAGE_KEYS,
  StorageManager,
  DataMigration,
  storage,
  secureStorage,
  getConfig,
  setConfig,
  getChatHistory,
  setChatHistory,
  addChatMessage,
  getDiaryEntries,
  setDiaryEntries,
  getExpenses,
  setExpenses,
  getHealthCycles,
  setHealthCycles,
  getMemories,
  setMemories,
  getBlindboxInventory,
  setBlindboxInventory,
  getCheckinStreak,
  setCheckinStreak,
  getTasks,
  setTasks,
  getSettings,
  setSettings,
  exportAllData,
  importAllData
};

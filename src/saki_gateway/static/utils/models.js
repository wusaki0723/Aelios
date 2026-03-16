/**
 * models.js - AI模型调用封装
 * 
 * 功能：
 * - 支持多模型协作（主模型/工具模型/爬虫模型）
 * - OpenAI兼容API调用
 * - 流式响应处理
 * - 意图识别和模型路由
 * - 错误处理
 * 
 * @author Love Phone App
 * @version 1.0.0
 */

// ============================================
// 模型配置常量
// ============================================

/**
 * 模型类型枚举
 */
export const MODEL_TYPES = {
  MAIN: 'main',           // 主模型 - 用于日常对话
  TOOL: 'tool',           // 工具模型 - 用于特定任务
  CRAWLER: 'crawler',     // 爬虫模型 - 用于信息获取
  VISION: 'vision',       // 视觉模型 - 用于图像理解
  EMBEDDING: 'embedding'  // 嵌入模型 - 用于向量化
};

/**
 * 用户意图类型枚举
 */
export const USER_INTENTS = {
  CHAT: 'chat',               // 普通聊天
  DIARY: 'diary',             // 写日记
  EXPENSE: 'expense',         // 记账
  HEALTH: 'health',           // 健康记录
  MEMORY: 'memory',           // 记忆查询
  TASK: 'task',               // 任务管理
  SEARCH: 'search',           // 搜索信息
  IMAGE: 'image',             // 图像相关
  WEATHER: 'weather',         // 天气查询
  REMINDER: 'reminder',       // 提醒设置
  ANNIVERSARY: 'anniversary', // 纪念日
  UNKNOWN: 'unknown'          // 未知意图
};

/**
 * 默认模型配置
 */
export const DEFAULT_MODEL_CONFIG = {
  // 主模型配置
  [MODEL_TYPES.MAIN]: {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 2048,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0
  },
  // 工具模型配置
  [MODEL_TYPES.TOOL]: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 1024,
    topP: 1
  },
  // 爬虫模型配置
  [MODEL_TYPES.CRAWLER]: {
    model: 'gpt-4o-mini',
    temperature: 0.5,
    maxTokens: 2048
  },
  // 视觉模型配置
  [MODEL_TYPES.VISION]: {
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2048
  },
  // 嵌入模型配置
  [MODEL_TYPES.EMBEDDING]: {
    model: 'text-embedding-3-small'
  }
};

// ============================================
// 意图识别器
// ============================================

/**
 * 意图识别器
 * 用于分析用户消息，识别用户意图
 */
export class IntentDetector {
  constructor() {
    // 意图关键词映射
    this.intentKeywords = {
      [USER_INTENTS.DIARY]: [
        '写日记', '日记', '记录今天', '今天发生了', '心情', '感受',
        'diary', 'journal', '记录', 'memo'
      ],
      [USER_INTENTS.EXPENSE]: [
        '记账', '花了', '消费', '支出', '收入', '花了多少钱',
        'expense', 'cost', 'spent', 'money', '账单', 'budget'
      ],
      [USER_INTENTS.HEALTH]: [
        '生理期', '月经', '周期', '健康', '不舒服', '身体',
        'period', 'cycle', 'health', '症状', '体温'
      ],
      [USER_INTENTS.MEMORY]: [
        '记得', '回忆', '以前', '上次', '我们去过', '记忆',
        'memory', 'remember', 'recall', 'history', 'past'
      ],
      [USER_INTENTS.TASK]: [
        '任务', 'todo', '待办', '提醒我做', '记得做', '计划',
        'task', 'todo', 'remind me to', 'schedule', 'plan'
      ],
      [USER_INTENTS.SEARCH]: [
        '搜索', '查找', '查询', '是什么', '为什么', '怎么',
        'search', 'find', 'look up', 'what is', 'how to'
      ],
      [USER_INTENTS.IMAGE]: [
        '图片', '照片', '生成图', '画一个', '看看', 'image',
        'picture', 'photo', 'generate image', 'draw', 'show me'
      ],
      [USER_INTENTS.WEATHER]: [
        '天气', '温度', '下雨', '晴天', 'weather',
        'temperature', 'rain', 'sunny', 'forecast'
      ],
      [USER_INTENTS.REMINDER]: [
        '提醒我', '闹钟', '定时', 'remind me', 'alarm',
        'set reminder', 'notify me'
      ],
      [USER_INTENTS.ANNIVERSARY]: [
        '纪念日', '纪念', '周年', 'anniversary', 'special day',
        '重要日子', '相识', '在一起'
      ]
    };
  }

  /**
   * 检测用户意图
   * @param {string} message - 用户消息
   * @returns {Object} 意图识别结果
   */
  detect(message) {
    if (!message || typeof message !== 'string') {
      return { intent: USER_INTENTS.UNKNOWN, confidence: 0 };
    }

    const lowerMessage = message.toLowerCase();
    const scores = {};

    // 计算每个意图的匹配分数
    for (const [intent, keywords] of Object.entries(this.intentKeywords)) {
      scores[intent] = this._calculateScore(lowerMessage, keywords);
    }

    // 找出最高分的意图
    let maxIntent = USER_INTENTS.CHAT;
    let maxScore = scores[USER_INTENTS.CHAT] || 0;

    for (const [intent, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxIntent = intent;
      }
    }

    // 计算置信度
    const confidence = Math.min(maxScore / 3, 1);

    return {
      intent: maxIntent,
      confidence,
      scores
    };
  }

  /**
   * 计算匹配分数
   * @param {string} message - 用户消息
   * @param {string[]} keywords - 关键词列表
   * @returns {number} 匹配分数
   * @private
   */
  _calculateScore(message, keywords) {
    let score = 0;
    
    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      
      // 完全匹配
      if (message.includes(lowerKeyword)) {
        score += 1;
        
        // 如果关键词在消息开头，额外加分
        if (message.startsWith(lowerKeyword)) {
          score += 0.5;
        }
      }
      
      // 部分匹配（关键词包含在消息中）
      if (lowerKeyword.length > 2 && message.includes(lowerKeyword.slice(0, -1))) {
        score += 0.3;
      }
    }
    
    return score;
  }

  /**
   * 批量检测意图
   * @param {string[]} messages - 消息数组
   * @returns {Object[]} 意图识别结果数组
   */
  detectBatch(messages) {
    return messages.map(msg => this.detect(msg));
  }
}

// ============================================
// 模型路由器
// ============================================

/**
 * 模型路由器
 * 根据用户意图和上下文，路由到不同的模型
 */
export class ModelRouter {
  constructor(config = {}) {
    this.intentDetector = new IntentDetector();
    this.config = {
      ...DEFAULT_MODEL_CONFIG,
      ...config
    };
    
    // 意图到模型类型的映射
    this.intentModelMap = {
      [USER_INTENTS.CHAT]: MODEL_TYPES.MAIN,
      [USER_INTENTS.DIARY]: MODEL_TYPES.MAIN,
      [USER_INTENTS.EXPENSE]: MODEL_TYPES.TOOL,
      [USER_INTENTS.HEALTH]: MODEL_TYPES.TOOL,
      [USER_INTENTS.MEMORY]: MODEL_TYPES.MAIN,
      [USER_INTENTS.TASK]: MODEL_TYPES.TOOL,
      [USER_INTENTS.SEARCH]: MODEL_TYPES.CRAWLER,
      [USER_INTENTS.IMAGE]: MODEL_TYPES.VISION,
      [USER_INTENTS.WEATHER]: MODEL_TYPES.TOOL,
      [USER_INTENTS.REMINDER]: MODEL_TYPES.TOOL,
      [USER_INTENTS.ANNIVERSARY]: MODEL_TYPES.MAIN,
      [USER_INTENTS.UNKNOWN]: MODEL_TYPES.MAIN
    };
  }

  /**
   * 路由用户消息到不同模型
   * @param {string} message - 用户消息
   * @param {Object} context - 上下文信息
   * @returns {Object} 路由结果
   */
  async route(message, context = {}) {
    // 检测用户意图
    const intentResult = this.intentDetector.detect(message);
    
    // 根据意图选择模型类型
    const modelType = this.intentModelMap[intentResult.intent] || MODEL_TYPES.MAIN;
    
    // 获取模型配置
    const modelConfig = this.config[modelType] || this.config[MODEL_TYPES.MAIN];
    
    // 构建系统提示词
    const systemPrompt = this._buildSystemPrompt(intentResult.intent, context);
    
    return {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      modelType,
      modelConfig,
      systemPrompt,
      shouldUseTools: this._shouldUseTools(intentResult.intent),
      suggestedActions: this._getSuggestedActions(intentResult.intent)
    };
  }

  /**
   * 构建系统提示词
   * @param {string} intent - 用户意图
   * @param {Object} context - 上下文信息
   * @returns {string} 系统提示词
   * @private
   */
  _buildSystemPrompt(intent, context) {
    const basePrompt = `你是恋爱小手机的AI助手，一个温暖、贴心、专业的恋爱伴侣助手。`;
    
    const intentPrompts = {
      [USER_INTENTS.CHAT]: `${basePrompt} 请用温柔、体贴的语气回复，像恋人一样关心对方。`,
      [USER_INTENTS.DIARY]: `${basePrompt} 帮助用户记录日记，可以引导用户表达情感，提供情感支持。`,
      [USER_INTENTS.EXPENSE]: `${basePrompt} 帮助用户记录消费，分析支出情况，提供理财建议。`,
      [USER_INTENTS.HEALTH]: `${basePrompt} 帮助用户记录健康数据，关注身体状况，提供健康建议。`,
      [USER_INTENTS.MEMORY]: `${basePrompt} 帮助用户回忆美好时光，唤起温馨的回忆。`,
      [USER_INTENTS.TASK]: `${basePrompt} 帮助用户管理任务，提醒重要事项。`,
      [USER_INTENTS.SEARCH]: `${basePrompt} 帮助用户搜索信息，提供准确、有用的答案。`,
      [USER_INTENTS.IMAGE]: `${basePrompt} 帮助用户处理图像相关需求。`,
      [USER_INTENTS.WEATHER]: `${basePrompt} 提供天气信息，并给出贴心的出行建议。`,
      [USER_INTENTS.REMINDER]: `${basePrompt} 帮助用户设置提醒，确保不会忘记重要事项。`,
      [USER_INTENTS.ANNIVERSARY]: `${basePrompt} 帮助用户记录和庆祝重要的纪念日。`,
      [USER_INTENTS.UNKNOWN]: basePrompt
    };
    
    let prompt = intentPrompts[intent] || basePrompt;
    
    // 添加上下文信息
    if (context.userName) {
      prompt += ` 用户昵称是${context.userName}。`;
    }
    if (context.partnerName) {
      prompt += ` 伴侣昵称是${context.partnerName}。`;
    }
    if (context.relationshipDays) {
      prompt += ` 你们已经在一起${context.relationshipDays}天了。`;
    }
    
    return prompt;
  }

  /**
   * 判断是否需要使用工具
   * @param {string} intent - 用户意图
   * @returns {boolean} 是否需要使用工具
   * @private
   */
  _shouldUseTools(intent) {
    const toolIntents = [
      USER_INTENTS.EXPENSE,
      USER_INTENTS.HEALTH,
      USER_INTENTS.TASK,
      USER_INTENTS.WEATHER,
      USER_INTENTS.REMINDER,
      USER_INTENTS.SEARCH
    ];
    return toolIntents.includes(intent);
  }

  /**
   * 获取建议的操作
   * @param {string} intent - 用户意图
   * @returns {string[]} 建议的操作列表
   * @private
   */
  _getSuggestedActions(intent) {
    const actionMap = {
      [USER_INTENTS.DIARY]: ['保存日记', '添加标签', '设置心情'],
      [USER_INTENTS.EXPENSE]: ['记录支出', '查看账单', '设置预算'],
      [USER_INTENTS.HEALTH]: ['记录周期', '查看预测', '记录症状'],
      [USER_INTENTS.TASK]: ['创建任务', '设置提醒', '查看待办'],
      [USER_INTENTS.MEMORY]: ['添加记忆', '查看相册', '时间轴'],
      [USER_INTENTS.WEATHER]: ['查看天气', '出行建议', '穿衣指南']
    };
    
    return actionMap[intent] || [];
  }
}

// ============================================
// 聊天API封装
// ============================================

/**
 * 聊天API封装类
 * 支持OpenAI兼容的API调用
 */
export class ChatAPI {
  /**
   * 创建ChatAPI实例
   * @param {Object} config - API配置
   * @param {string} config.apiKey - API密钥
   * @param {string} config.baseURL - API基础URL
   * @param {string} config.model - 默认模型
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
    this.defaultModel = config.model || 'gpt-4o-mini';
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
   * 测试API连接
   * @param {Object} config - 可选的测试配置
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection(config = null) {
    const testConfig = config || {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      model: this.defaultModel
    };

    try {
      const response = await this.sendMessage(
        [{ role: 'user', content: 'Hello' }],
        {
          ...testConfig,
          maxTokens: 10,
          temperature: 0
        }
      );

      return {
        success: true,
        message: '连接成功',
        model: response.model,
        latency: response.latency
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        error: error.type || 'unknown'
      };
    }
  }

  /**
   * 发送聊天请求
   * @param {Array} messages - 消息数组
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} 响应结果
   */
  async sendMessage(messages, config = {}) {
    const requestConfig = {
      model: config.model || this.defaultModel,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens || 2048,
      top_p: config.topP ?? 1,
      frequency_penalty: config.frequencyPenalty || 0,
      presence_penalty: config.presencePenalty || 0,
      stream: false
    };

    // 如果有工具调用
    if (config.tools) {
      requestConfig.tools = config.tools;
      requestConfig.tool_choice = config.toolChoice || 'auto';
    }

    return this._makeRequest('/chat/completions', requestConfig);
  }

  /**
   * 流式响应
   * @param {Array} messages - 消息数组
   * @param {Object} config - 请求配置
   * @param {Function} onChunk - 接收数据块的回调函数
   * @returns {Promise<Object>} 完整响应
   */
  async streamResponse(messages, config = {}, onChunk = null) {
    const requestConfig = {
      model: config.model || this.defaultModel,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens || 2048,
      stream: true
    };

    const startTime = Date.now();
    let fullContent = '';
    let fullReasoning = '';

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey || this.apiKey}`
        },
        body: JSON.stringify(requestConfig)
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new APIError(
          error.error?.message || `HTTP ${response.status}`,
          error.error?.type || 'api_error',
          response.status
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              
              if (delta) {
                // 处理 reasoning_content (深度思考)
                if (delta.reasoning_content) {
                  fullReasoning += delta.reasoning_content;
                  if (onChunk) {
                    onChunk({
                      type: 'reasoning',
                      content: delta.reasoning_content,
                      fullReasoning
                    });
                  }
                }
                
                // 处理普通 content
                if (delta.content) {
                  fullContent += delta.content;
                  if (onChunk) {
                    onChunk({
                      type: 'content',
                      content: delta.content,
                      fullContent
                    });
                  }
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      return {
        content: fullContent,
        reasoning: fullReasoning,
        model: requestConfig.model,
        latency: Date.now() - startTime
      };

    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError(error.message, 'stream_error');
    }
  }

  /**
   * 获取嵌入向量
   * @param {string|string[]} input - 输入文本
   * @param {Object} config - 配置
   * @returns {Promise<Object>} 嵌入结果
   */
  async getEmbedding(input, config = {}) {
    const requestConfig = {
      model: config.model || 'text-embedding-3-small',
      input: Array.isArray(input) ? input : [input]
    };

    return this._makeRequest('/embeddings', requestConfig);
  }

  /**
   * 发送请求（带重试机制）
   * @param {string} endpoint - API端点
   * @param {Object} data - 请求数据
   * @param {number} retryCount - 当前重试次数
   * @returns {Promise<Object>} 响应结果
   * @private
   */
  async _makeRequest(endpoint, data, retryCount = 0) {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        
        // 处理特定错误码
        if (response.status === 429 && retryCount < this.maxRetries) {
          // 速率限制，等待后重试
          await this._delay(this.retryDelay * (retryCount + 1));
          return this._makeRequest(endpoint, data, retryCount + 1);
        }
        
        if (response.status >= 500 && retryCount < this.maxRetries) {
          // 服务器错误，重试
          await this._delay(this.retryDelay);
          return this._makeRequest(endpoint, data, retryCount + 1);
        }

        throw new APIError(
          error.error?.message || `HTTP ${response.status}`,
          error.error?.type || 'api_error',
          response.status
        );
      }

      const result = await response.json();
      
      return {
        ...result,
        latency: Date.now() - startTime
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new APIError('请求超时', 'timeout_error');
      }
      
      if (error instanceof APIError) {
        throw error;
      }
      
      // 网络错误，尝试重试
      if (retryCount < this.maxRetries) {
        await this._delay(this.retryDelay);
        return this._makeRequest(endpoint, data, retryCount + 1);
      }
      
      throw new APIError(error.message, 'network_error');
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
// API错误类
// ============================================

/**
 * API错误类
 */
export class APIError extends Error {
  constructor(message, type = 'unknown', statusCode = null) {
    super(message);
    this.name = 'APIError';
    this.type = type;
    this.statusCode = statusCode;
  }

  /**
   * 获取用户友好的错误消息
   * @returns {string} 错误消息
   */
  getUserMessage() {
    const messages = {
      'timeout_error': '请求超时，请稍后重试',
      'network_error': '网络连接失败，请检查网络',
      'rate_limit': '请求太频繁，请稍后再试',
      'invalid_api_key': 'API密钥无效，请检查配置',
      'insufficient_quota': 'API额度不足，请联系管理员',
      'api_error': '服务暂时不可用，请稍后重试'
    };
    
    return messages[this.type] || '发生错误，请稍后重试';
  }
}

// ============================================
// 多模型管理器
// ============================================

/**
 * 多模型管理器
 * 管理多个模型的配置和调用
 */
export class MultiModelManager {
  constructor() {
    this.models = new Map();
    this.defaultModel = null;
  }

  /**
   * 注册模型
   * @param {string} name - 模型名称
   * @param {ChatAPI} api - ChatAPI实例
   * @param {boolean} isDefault - 是否设为默认
   */
  register(name, api, isDefault = false) {
    this.models.set(name, api);
    
    if (isDefault || !this.defaultModel) {
      this.defaultModel = name;
    }
  }

  /**
   * 获取模型
   * @param {string} name - 模型名称
   * @returns {ChatAPI|null} ChatAPI实例
   */
  get(name = null) {
    const modelName = name || this.defaultModel;
    return this.models.get(modelName) || null;
  }

  /**
   * 发送消息（自动选择模型）
   * @param {string} modelName - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} config - 配置
   * @returns {Promise<Object>} 响应结果
   */
  async sendMessage(modelName, messages, config = {}) {
    const api = this.get(modelName);
    
    if (!api) {
      throw new APIError(`Model ${modelName} not found`, 'model_not_found');
    }
    
    return api.sendMessage(messages, config);
  }

  /**
   * 流式响应（自动选择模型）
   * @param {string} modelName - 模型名称
   * @param {Array} messages - 消息数组
   * @param {Object} config - 配置
   * @param {Function} onChunk - 回调函数
   * @returns {Promise<Object>} 响应结果
   */
  async streamResponse(modelName, messages, config = {}, onChunk = null) {
    const api = this.get(modelName);
    
    if (!api) {
      throw new APIError(`Model ${modelName} not found`, 'model_not_found');
    }
    
    return api.streamResponse(messages, config, onChunk);
  }

  /**
   * 测试所有模型连接
   * @returns {Promise<Object>} 测试结果
   */
  async testAllConnections() {
    const results = {};
    
    for (const [name, api] of this.models) {
      results[name] = await api.testConnection();
    }
    
    return results;
  }
}

// ============================================
// 便捷函数
// ============================================

/**
 * 创建默认的ChatAPI实例
 * @param {Object} config - 配置
 * @returns {ChatAPI} ChatAPI实例
 */
export function createChatAPI(config = {}) {
  return new ChatAPI(config);
}

/**
 * 创建默认的ModelRouter实例
 * @param {Object} config - 配置
 * @returns {ModelRouter} ModelRouter实例
 */
export function createModelRouter(config = {}) {
  return new ModelRouter(config);
}

/**
 * 快速发送聊天消息
 * @param {string} message - 用户消息
 * @param {Object} apiConfig - API配置
 * @param {Object} context - 上下文
 * @returns {Promise<Object>} 响应结果
 */
export async function quickChat(message, apiConfig = {}, context = {}) {
  const router = createModelRouter();
  const routeResult = await router.route(message, context);
  
  const api = createChatAPI(apiConfig);
  
  const messages = [
    { role: 'system', content: routeResult.systemPrompt },
    { role: 'user', content: message }
  ];
  
  const response = await api.sendMessage(messages, routeResult.modelConfig);
  
  return {
    ...response,
    intent: routeResult.intent,
    suggestedActions: routeResult.suggestedActions
  };
}

// ============================================
// 默认导出
// ============================================

export default {
  MODEL_TYPES,
  USER_INTENTS,
  DEFAULT_MODEL_CONFIG,
  IntentDetector,
  ModelRouter,
  ChatAPI,
  APIError,
  MultiModelManager,
  createChatAPI,
  createModelRouter,
  quickChat
};

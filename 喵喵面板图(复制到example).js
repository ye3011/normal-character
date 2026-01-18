import plugin from '../../lib/plugins/plugin.js'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import common from '../../lib/common/common.js'
import Cfg from '../../lib/config/config.js'
import fetch from 'node-fetch'

/**
 * 【配置区域】
 * 如果你的仓库是私有库，请在下方填写对应的 Token
 * GitHub Token 获取: https://github.com/settings/tokens (需要 repo 权限)
 * GitCode Token 获取: https://gitcode.com/-/profile/personal_access_tokens
 */
const PRIVATE_TOKEN = {
  github: '',  // 填写你的 GitHub Personal Access Token
  gitcode: ''  // 填写你的 GitCode Access Token
}

const updateInfo = {}

export class updatePanel extends plugin {
  constructor() {
    super({
      name: '面板图自动更新(全兼容版)',
      dsc: '自动识别目录并检测 API 更新(支持GitHub/GitCode私有库)',
      event: 'message',
      priority: 10,
      rule: [
        {
          reg: '^#更新面板图$',
          fnc: 'updatePanel'
        },
        {
          reg: '^#面板图测试$',
          fnc: 'testUpdate'
        }
      ]
    })

    this.basePath = path.join(process.cwd(), 'plugins', 'miao-plugin', 'resources', 'profile')

    this.task = {
      name: '面板图自动更新',
      cron: '0 0/120 * * * ?', // 每 120 分钟执行一次
      fnc: () => this.checkAllUpdates()
    }
  }

  async updatePanel() {
    if (!this.e.isMaster) return
    await this.checkAllUpdates(true)
    this.e.reply('✨ 检测完毕')
  }

  /**
   * 获取请求头（适配私有库 Token）
   */
  getHeaders(type) {
    let headers = { 'User-Agent': 'Yunzai-Bot' }
    if (type === 'github' && PRIVATE_TOKEN.github) {
      headers['Authorization'] = `token ${PRIVATE_TOKEN.github}`
    } else if (type === 'gitcode' && PRIVATE_TOKEN.gitcode) {
      headers['Authorization'] = `Bearer ${PRIVATE_TOKEN.gitcode}`
    }
    return headers
  }

  getRepoInfo(repoPath) {
    try {
      const remote = execSync(`cd "${repoPath}" && git remote -v`, { encoding: 'utf-8' })
      let owner, repo, type

      // 匹配 GitHub (兼容 SSH 和 HTTPS)
      let match = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git|\s)/)
      if (match) {
        type = 'github'
        owner = match[1]
        repo = match[2]
      } else {
        // 匹配 GitCode (兼容 SSH 和 HTTPS)
        match = remote.match(/gitcode\.(?:com|net)[:/](.+?)\/(.+?)(?:\.git|\s)/)
        if (match) {
          type = 'gitcode'
          owner = match[1]
          repo = match[2]
        }
      }

      if (!type) return null

      let branch = 'master'
      try {
        branch = execSync(`cd "${repoPath}" && git rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()
        if (branch === 'HEAD') {
          branch = execSync(`cd "${repoPath}" && git remote show origin | grep "HEAD branch" | cut -d' ' -f5`, { encoding: 'utf-8' }).trim()
        }
      } catch (e) { branch = 'master' }

      return { owner, repo, branch: branch || 'master', type }
    } catch (e) {
      return null
    }
  }

  async checkAllUpdates(isManual = false) {
    if (!fs.existsSync(this.basePath)) return
    const dirs = fs.readdirSync(this.basePath).filter(file => {
      const fullPath = path.join(this.basePath, file)
      return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, '.git'))
    })

    if (isManual) this.e.reply(`📦 正在扫描 ${dirs.length} 个仓库...`)

    for (let dirName of dirs) {
      const repoPath = path.join(this.basePath, dirName)
      const info = this.getRepoInfo(repoPath)
      if (info) await this.processUpdate(dirName, repoPath, info, isManual)
    }
  }

  async processUpdate(dirName, repoPath, info, isManual) {
    let apiUrl = info.type === 'gitcode'
      ? `https://api.gitcode.com/api/v5/repos/${info.owner}/${info.repo}/commits/${info.branch}`
      : `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${info.branch}`
    
    try {
      const localSha = execSync(`cd "${repoPath}" && git rev-parse HEAD`, { encoding: 'utf-8' }).trim()
      
      const response = await fetch(`${apiUrl}?t=${new Date().getTime()}`, {
        headers: this.getHeaders(info.type),
        timeout: 10000
      })

      if (!response.ok) {
        if (isManual) console.log(`[面板图更新] ${dirName} API请求失败: ${response.status} (检查Token是否正确)`)
        return
      }
      
      const result = await response.json()
      const remoteSha = result.sha 

      if (localSha !== remoteSha) {
        if (!isManual && updateInfo[dirName] === remoteSha) return

        // 提示：私有库 git pull 需要服务器本地已配置 SSH Key 或 git 凭据
        execSync(`cd "${repoPath}" && git reset --hard HEAD && git pull origin ${info.branch}`, { stdio: 'pipe' })

        const updateLog = [
          `[面板图更新] ${dirName}`,
          `🏠 平台：${info.type === 'gitcode' ? 'GitCode' : 'GitHub'}`,
          `🌿 分支：${info.branch}`,
          `📌 内容：${result.commit.message.split('\n')[0]}`,
          `📅 时间：${new Date(result.commit.committer.date).toLocaleString()}`
        ].join('\n')

        await this.notifyMaster(updateLog)
        updateInfo[dirName] = remoteSha
        if (isManual) this.e.reply(`✅ ${dirName} 更新成功`)
      }
    } catch (err) {
      console.error(`[面板图更新] ${dirName} 异常: ${err.message}`)
    }
  }

  async testUpdate() {
    if (!this.e.isMaster) return
    this.e.reply('🧪 深度识别测试中(含私有库检测)...')

    const dirs = fs.readdirSync(this.basePath).filter(file => {
      const fullPath = path.join(this.basePath, file)
      return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, '.git'))
    })

    for (let dirName of dirs) {
      const repoPath = path.join(this.basePath, dirName)
      const info = this.getRepoInfo(repoPath)
      if (!info) continue

      try {
        const localSha = execSync(`cd "${repoPath}" && git rev-parse HEAD`, { encoding: 'utf-8' }).trim()
        let apiUrl = info.type === 'gitcode'
          ? `https://api.gitcode.com/api/v5/repos/${info.owner}/${info.repo}/commits/${info.branch}`
          : `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${info.branch}`

        const res = await fetch(apiUrl, { headers: this.getHeaders(info.type) })
        
        if (res.ok) {
          const data = await res.json()
          await this.e.reply([
            `✅ ${dirName}`,
            `🏠 平台: ${info.type === 'gitcode' ? 'GitCode' : 'GitHub'}`,
            `📡 源: ${info.owner}/${info.repo}`,
            `📍 本地: ${localSha.substring(0, 7)}`,
            `☁️ 远程: ${data.sha.substring(0, 7)}`,
            `🔑 鉴权: ${PRIVATE_TOKEN[info.type] ? '已配置Token' : '未配置Token'}`
          ].join('\n'))
        } else {
          await this.e.reply(`❎ ${dirName}: API失败(${res.status})，私有库请检查Token`)
        }
      } catch (e) {
        await this.e.reply(`❎ ${dirName}: 检测出错`)
      }
    }
    this.e.reply('✨ 测试结束')
  }

  async notifyMaster(msg) {
    const masters = Cfg.masterQQ || []
    for (const master of masters) {
      const userId = master.toString()
      if (userId === 'stdin' || userId.length > 11) continue
      try {
        await common.relpyPrivate(userId, msg)
        break 
      } catch (e) {
        console.error(`[面板图更新] 通知主号 ${userId} 失败`)
      }
    }
  }
}

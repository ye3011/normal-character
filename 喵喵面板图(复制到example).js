import plugin from '../../lib/plugins/plugin.js'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import common from '../../lib/common/common.js'
import Cfg from '../../lib/config/config.js'
import fetch from 'node-fetch'

const updateInfo = {}

export class updatePanel extends plugin {
  constructor() {
    super({
      name: '面板图自动更新(全兼容版)',
      dsc: '自动识别目录、仓库地址及分支并检测 API 更新',
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
  cron: '0 0/120 * * * ?',  // 每 120 分钟执行一次
  fnc: () => this.checkAllUpdates()
}
}
  /**
   * 核心：获取仓库信息（Owner, Repo, Branch）
   */
  getRepoInfo(repoPath) {
    try {
      // 1. 获取远程地址
      const remote = execSync(`cd "${repoPath}" && git remote -v`, { encoding: 'utf-8' })
      const match = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git|\s)/)
      if (!match) return null

      // 2. 获取当前分支名 (优先取本地 HEAD 所在分支)
      let branch = 'master'
      try {
        branch = execSync(`cd "${repoPath}" && git rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim()
        // 如果处于游离状态，尝试取远程分支名
        if (branch === 'HEAD') {
            branch = execSync(`cd "${repoPath}" && git remote show origin | grep "HEAD branch" | cut -d' ' -f5`, { encoding: 'utf-8' }).trim()
        }
      } catch (e) { branch = 'master' }

      return { owner: match[1], repo: match[2], branch: branch || 'master' }
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
    // 动态拼接分支 API 地址
    const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${info.branch}`
    
    try {
      const localSha = execSync(`cd "${repoPath}" && git rev-parse HEAD`, { encoding: 'utf-8' }).trim()
      const response = await fetch(`${apiUrl}?t=${new Date().getTime()}`, {
        headers: { 'User-Agent': 'Yunzai-Bot' },
        timeout: 10000
      })

      if (!response.ok) return
      const result = await response.json()
      const remoteSha = result.sha

      if (localSha !== remoteSha) {
        if (!isManual && updateInfo[dirName] === remoteSha) return

        // 执行拉取
        execSync(`cd "${repoPath}" && git reset --hard HEAD && git pull origin ${info.branch}`, { stdio: 'pipe' })

        const updateLog = [
          `[面板图更新] ${dirName}`,
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
    this.e.reply('🧪 深度识别测试中...')

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
        const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${info.branch}`
        const res = await fetch(apiUrl, { headers: { 'User-Agent': 'Yunzai-Bot' } })
        
        if (res.ok) {
          const data = await res.json()
          await this.e.reply([
            `✅ ${dirName}`,
            `📡 源: ${info.owner}/${info.repo}`,
            `🌿 分支: ${info.branch}`,
            `📍 本地: ${localSha.substring(0, 7)}`,
            `☁️ 远程: ${data.sha.substring(0, 7)}`
          ].join('\n'))
        }
      } catch (e) {}
    }
    this.e.reply('✨ 测试结束')
  }

  async notifyMaster(msg) {
    const masters = Cfg.masterQQ || []
    for (const master of masters) {
      const userId = master.toString()
      if (userId === 'stdin' || userId.length > 11) continue
      await common.relpyPrivate(userId, msg)
      break
    }
  }

  async updatePanel() {
    if (!this.e.isMaster) return
    await this.checkAllUpdates(true)
    this.e.reply('✨ 检测完毕')
  }
}
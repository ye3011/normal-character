import { exec, execSync } from 'child_process'
import fs from 'fs'
const Path = './plugins/miao-plugin/resources/profile/normal-character'
const url = 'https://github.com/ye3011/normal-character'
export class Updatenormal extends plugin {
  constructor () {
    super({
      name: '面板图更新',
      dsc: '更新角色面板图',
      event: 'message',
      priority: 100,
      rule: [
        {
          reg: '^#(强制)?面板图(更新|下载)$',
          fnc: 'Updatenormal'
        }
      ]
    })
  }

  async Updatenormal (e) {
    let cmd = ''
    if (!fs.existsSync(Path) || this.e.msg.includes('下载')) {
      await this.reply(`开始下载${url}`)
      cmd = `git clone --depth=1 ${url} ${Path}`
      exec(cmd, { cwd: process.cwd(), stdio: 'inherit' }, (error) => {
        if (error) { return this.reply(`下载错误：\n${error}`) } else {
          this.reply('面板图下载完成')
        }
      })
    } else {
      await this.reply(`面板图更新中，保存路径${Path}`)
      cmd = 'git pull'
      if (this.e.msg.includes('强制')) { execSync('git fetch && git reset --hard', { cwd: Path }) }
      exec(cmd, { cwd: Path, stdio: 'inherit' }, (output, error) => {
        if (error) {
          if (error.match(/Already up to date\./)) { this.reply('当前面板图已是最新') } else {
            this.reply('面板图更新成功')
          }
        } else { return this.reply(`更新失败，连接错误：${output}`) }
      })
    }
  }
}
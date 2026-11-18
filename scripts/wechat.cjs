const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, '.scratch', 'wechat');

function findCli(env = process.env, exists = fs.existsSync) {
  if (env.WECHAT_CLI) {
    const cli = path.resolve(env.WECHAT_CLI);
    if (!exists(cli)) throw new Error(`WECHAT_CLI 指向的文件不存在：${cli}`);
    return cli;
  }
  const candidates = process.platform === 'win32'
    ? [
      'D:/Weixindeveloperstool/微信web开发者工具/cli.bat',
      ...[env['ProgramFiles(x86)'], env.ProgramFiles, 'C:/Program Files (x86)', 'C:/Program Files']
        .filter(Boolean).map(root => path.join(root, 'Tencent', '微信web开发者工具', 'cli.bat')),
    ]
    : ['/Applications/wechatwebdevtools.app/Contents/MacOS/cli'];
  const cli = candidates.find(exists);
  if (!cli) throw new Error('未找到微信开发者工具 CLI，请设置 WECHAT_CLI 为 cli.bat（macOS 为 cli）的完整路径。');
  return cli;
}

function buildArgs(action, params = []) {
  if (!['open', 'preview', 'upload'].includes(action)) {
    throw new Error('用法：wechat.cjs open | preview | upload <版本号> <描述>');
  }
  if (action === 'upload') {
    if (params.length !== 2 || params.some(value => !value.trim())) {
      throw new Error('上传必须提供版本号和描述，例如：npm run wx:upload -- 1.0.1 "修复设备切换"');
    }
    if (!/^[\w.-]+$/.test(params[0])) throw new Error('版本号仅支持字母、数字、下划线、点和短横线。');
  } else if (params.length) {
    throw new Error(`${action} 不接受额外参数。`);
  }
  const args = [action, '--project', projectRoot];
  if (action === 'preview') {
    args.push('--qr-format', 'image', '--qr-output', path.join(outputDir, 'preview.png'),
      '--info-output', path.join(outputDir, 'preview-info.json'));
  }
  if (action === 'upload') {
    args.push('--version', params[0], '--desc', params[1],
      '--info-output', path.join(outputDir, 'upload-info.json'));
  }
  return args;
}

// cmd.exe 必须调用批处理文件；所有参数加引号，并拒绝会破坏引用或触发变量展开的字符。
function windowsCommand(cli, args) {
  return [cli, ...args].map(value => {
    if (/["%\r\n\0]/.test(value)) {
      throw new Error('Windows CLI 路径和参数不能包含双引号、百分号、换行或空字符。');
    }
    return `"${value}"`;
  }).join(' ');
}

function main(argv = process.argv.slice(2)) {
  const [action, ...params] = argv;
  const args = buildArgs(action, params);
  const cli = findCli();
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'project.config.json'), 'utf8'));
  if (!config.appid || !config.projectname) throw new Error('project.config.json 必须包含 appid 和 projectname。');
  // 在删除旧产物、启动外部进程前完成 Windows 参数验证。
  const command = process.platform === 'win32' ? windowsCommand(cli, args) : null;
  if (action !== 'open') {
    fs.mkdirSync(outputDir, { recursive: true });
    const files = action === 'preview' ? ['preview.png', 'preview-info.json'] : ['upload-info.json'];
    for (const file of files) fs.rmSync(path.join(outputDir, file), { force: true });
  }
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/v:off', '/c', `"${command}"`], {
      stdio: 'inherit', windowsVerbatimArguments: true,
    })
    : spawnSync(cli, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error('微信 CLI 执行失败。请检查登录、项目权限，以及「设置 → 安全设置 → 服务端口」。');
    return result.status > 0 ? result.status : 1;
  }
  if (action === 'preview') console.log(`预览二维码：${path.join(outputDir, 'preview.png')}`);
  if (action === 'upload') console.log(`开发版本 ${params[0]} 上传成功；设为体验版、提审和发布请在微信后台人工操作。`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildArgs, findCli, windowsCommand, main };

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildArgs, findCli, windowsCommand } = require('../scripts/wechat.cjs');

const root = path.resolve(__dirname, '..');

test('open 使用项目绝对路径', () => {
  assert.deepEqual(buildArgs('open'), ['open', '--project', root]);
});

test('preview 固定输出图片及结果信息', () => {
  assert.deepEqual(buildArgs('preview'), [
    'preview', '--project', root, '--qr-format', 'image',
    '--qr-output', path.join(root, '.scratch/wechat/preview.png'),
    '--info-output', path.join(root, '.scratch/wechat/preview-info.json'),
  ]);
});

test('upload 要求显式版本号和描述，并保持中文描述完整', () => {
  assert.deepEqual(buildArgs('upload', ['1.0.1', '修复 设备切换']).slice(3), [
    '--version', '1.0.1', '--desc', '修复 设备切换',
    '--info-output', path.join(root, '.scratch/wechat/upload-info.json'),
  ]);
  for (const params of [[], ['1.0.1'], ['1.0.1', ' '], ['1.0.1', '描述', '额外参数']]) {
    assert.throws(() => buildArgs('upload', params));
  }
  assert.throws(() => buildArgs('upload', ['1 2', '描述']));
});

test('拒绝未知操作和多余参数', () => {
  assert.throws(() => buildArgs('publish'));
  assert.throws(() => buildArgs('open', ['extra']));
  assert.throws(() => buildArgs('preview', ['extra']));
});

test('环境变量路径优先且无效时不静默回退', () => {
  const custom = path.join(root, 'custom cli.bat');
  assert.equal(findCli({ WECHAT_CLI: custom }, file => file === custom), custom);
  assert.throws(() => findCli({ WECHAT_CLI: custom }, () => false), /不存在/);
  assert.throws(() => findCli({}, () => false), /WECHAT_CLI/);
});

test('Windows 参数全部引用，拒绝引号、变量展开和换行', () => {
  assert.equal(windowsCommand('C:\\工具 路径\\cli.bat', ['upload', '修复 & 检查!']),
    '"C:\\工具 路径\\cli.bat" "upload" "修复 & 检查!"');
  for (const value of ['a" & whoami', '%PATH%', 'a\nb', 'a\rb', 'a\0b']) {
    assert.throws(() => windowsCommand('cli.bat', [value]));
  }
});

test('缺少上传参数时退出失败，不调用微信 CLI', () => {
  const result = spawnSync(process.execPath, ['scripts/wechat.cjs', 'upload'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WECHAT_CLI: 'missing-cli.bat' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /上传必须提供版本号和描述/);
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { URL } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const config = {
  scanExtensions: ['.ts', '.js', '.tsx', '.jsx'],
  urlPattern: /["'\\](https?:\/\/[^"'\\]+\.(js|min\.js))["'\\]/g,
  localScriptsDir: 'external-scripts',
  ignoreDirs: ['node_modules', 'dist', '.git'],
  maxConcurrentDownloads: 5, // 最大并发下载数
  cacheFile: '.script-cache.json', // 缓存文件路径
};

// 缓存管理
class Cache {
  constructor(cachePath) {
    this.cachePath = cachePath;
    this.cache = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
    } catch {
      return {};
    }
  }

  save() {
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
  }

  getFileHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  hasChanged(filePath, content) {
    const hash = this.getFileHash(content);
    const changed = this.cache[filePath] !== hash;
    this.cache[filePath] = hash;
    return changed;
  }
}

// 下载文件
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`下载失败: ${response.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    // 设置超时
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('下载超时'));
    });

    request.on('error', reject);
  });
}

// 并发控制器
class ConcurrencyController {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async add(fn) {
    if (this.running >= this.maxConcurrent) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

// 递归扫描目录 - 使用 Promise.all 优化
async function scanDirectory(dir) {
  const files = [];
  
  async function scan(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    
    await Promise.all(entries.map(async entry => {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          await scan(fullPath);
        }
      } else if (entry.isFile() && config.scanExtensions.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }));
  }
  
  await scan(dir);
  return files;
}

// 处理单个文件
async function processFile(filePath, projectRoot, cache, controller) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  
  // 检查文件是否发生变化
  if (!cache.hasChanged(filePath, content)) {
    return false;
  }

  let newContent = content;
  let hasChanges = false;
  const matches = Array.from(content.matchAll(config.urlPattern));
  
  // 并发下载所有匹配的文件
  await Promise.all(matches.map(async match => {
    const url = match[1];
    const urlObj = new URL(url);
    const filename = path.basename(urlObj.pathname);
    
    // 确保文件保存在 public 目录下
    const localDir = path.join(projectRoot, 'public', config.localScriptsDir);
    await fs.promises.mkdir(localDir, { recursive: true });
    
    const localPath = path.join(localDir, filename);
    // 使用 config.localScriptsDir 生成相对路径，这样就不会包含 public
    const relativePath = path.relative(
      path.dirname(filePath),
      path.join(projectRoot, config.localScriptsDir, filename)
    ).replace(/\\/g, '/');
    
    try {
      await controller.add(async () => {
        console.log(`\n下载脚本: ${url}`);
        await downloadFile(url, localPath);
        console.log(`已保存到: ${localPath}`);
      });
      
      newContent = newContent.replace(url, relativePath);
      hasChanges = true;
    } catch (error) {
      console.error(`下载失败 ${url}:`, error.message);
    }
  }));
  
  if (hasChanges) {
    await fs.promises.writeFile(filePath, newContent, 'utf8');
    console.log(`已更新文件: ${filePath}`);
  }
  
  return hasChanges;
}

// 主函数
async function main() {
  try {
    const projectRoot = path.resolve(__dirname, '..');
    const cache = new Cache(path.join(projectRoot, config.cacheFile));
    const controller = new ConcurrencyController(config.maxConcurrentDownloads);
    
    console.log('开始扫描项目文件...');
    console.time('总耗时');
    
    const files = await scanDirectory(projectRoot);
    console.log(`找到 ${files.length} 个需要扫描的文件`);
    
    let processedCount = 0;
    let changedCount = 0;
    
    // 并发处理文件
    await Promise.all(files.map(async file => {
      const hasChanges = await processFile(file, projectRoot, cache, controller);
      processedCount++;
      if (hasChanges) changedCount++;
      
      const progress = Math.round((processedCount / files.length) * 100);
      process.stdout.write(`\r处理进度: ${progress}% (${processedCount}/${files.length})`);
    }));
    
    // 保存缓存
    cache.save();
    
    console.log('\n\n========== 处理完成 ==========');
    console.log(`总文件数: ${files.length}`);
    console.log(`修改文件数: ${changedCount}`);
    console.timeEnd('总耗时');
    console.log('==============================\n');
    
  } catch (error) {
    console.error('处理过程中发生错误:', error);
  }
}

main(); 
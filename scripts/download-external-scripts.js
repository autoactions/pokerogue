import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const config = {
  // 要扫描的文件扩展名
  scanExtensions: ['.ts', '.js', '.tsx', '.jsx'],
  // 外部脚本URL的正则表达式
  urlPattern: /["'\\](https?:\/\/[^"'\\]+\.(js|min\.js))["'\\]/g,
  // 本地保存路径(相对于项目根目录)
  localScriptsDir: 'public/external-scripts',
  // 忽略的目录
  ignoreDirs: ['node_modules', 'dist', '.git']
};

// 下载文件
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // 处理重定向
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
    }).on('error', reject);
  });
}

// 递归扫描目录
async function scanDirectory(dir) {
  const files = [];
  
  async function scan(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        if (!config.ignoreDirs.includes(entry.name)) {
          await scan(fullPath);
        }
      } else if (entry.isFile() && config.scanExtensions.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  
  await scan(dir);
  return files;
}

// 处理单个文件
async function processFile(filePath, projectRoot) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  let newContent = content;
  let hasChanges = false;
  const matches = content.matchAll(config.urlPattern);
  
  for (const match of matches) {
    const url = match[1];
    const urlObj = new URL(url);
    const filename = path.basename(urlObj.pathname);
    
    // 创建本地存储目录
    const localDir = path.join(projectRoot, config.localScriptsDir);
    await fs.promises.mkdir(localDir, { recursive: true });
    
    const localPath = path.join(localDir, filename);
    const relativePath = path.relative(path.dirname(filePath), localPath).replace(/\\/g, '/');
    
    // 下载文件
    try {
      console.log(`\n下载脚本: ${url}`);
      await downloadFile(url, localPath);
      console.log(`已保存到: ${localPath}`);
      
      // 更新引用
      newContent = newContent.replace(url, relativePath);
      hasChanges = true;
      
    } catch (error) {
      console.error(`下载失败 ${url}:`, error.message);
    }
  }
  
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
    console.log('开始扫描项目文件...');
    
    const files = await scanDirectory(projectRoot);
    console.log(`找到 ${files.length} 个需要扫描的文件`);
    
    let processedCount = 0;
    let changedCount = 0;
    
    for (const file of files) {
      processedCount++;
      const hasChanges = await processFile(file, projectRoot);
      if (hasChanges) changedCount++;
      
      // 显示进度
      const progress = Math.round((processedCount / files.length) * 100);
      process.stdout.write(`\r处理进度: ${progress}% (${processedCount}/${files.length})`);
    }
    
    console.log('\n\n========== 处理完成 ==========');
    console.log(`总文件数: ${files.length}`);
    console.log(`修改文件数: ${changedCount}`);
    console.log('==============================\n');
    
  } catch (error) {
    console.error('处理过程中发生错误:', error);
  }
}

main(); 
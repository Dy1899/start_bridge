import {packager} from '@electron/packager';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root=fileURLToPath(new URL('..',import.meta.url));
const paths=await packager({dir:root,out:path.join(root,'build'),name:'StarBridge',executableName:'StarBridge',platform:'win32',arch:'x64',electronVersion:'44.9.1',asar:false,prune:true,overwrite:false,download:{cacheRoot:process.env.electron_config_cache},ignore:[/^\/backup-before-/,/^\/(build|runtime|tests|scripts|deploy)(\/|$)/,/^\/native\/InputAgent\.cs$/,/^\/\.workspace$/,/^\/\.git/],win32metadata:{CompanyName:'StarBridge',FileDescription:'星桥远控',ProductName:'星桥远控',InternalName:'StarBridge'},appCopyright:'StarBridge contributors'});
for(const dir of paths){
  const launcher='@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0StarBridge.exe" "%~dp0resources\\app\\server\\index.mjs"\r\npause\r\n';
  await fs.writeFile(path.join(dir,'Start-local-server.cmd'),launcher,'utf8');
  await fs.writeFile(path.join(dir,'启动本机服务.cmd'),launcher,'utf8');
  const lanLauncher='@echo off\r\nchcp 65001 >nul\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0StarBridge.exe" "%~dp0resources\\app\\server\\lan.mjs"\r\npause\r\n';
  await fs.writeFile(path.join(dir,'启动局域网服务.cmd'),lanLauncher,'utf8');
  await fs.writeFile(path.join(dir,'Start-lan-server.cmd'),lanLauncher,'utf8');
  await fs.copyFile(path.join(root,'README.md'),path.join(dir,'使用说明.md'));
  console.log(dir);
}

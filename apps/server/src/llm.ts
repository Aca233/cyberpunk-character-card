import { basename, dirname } from "node:path";
import { ConfigService } from "./config";
import { FileDocStore } from "./file-store";

/** 给开发工具（测评）用的模型接入：读 config.json、按方案调用模型、去掉日志里的密钥 */
export { ConfigService, redact } from "./config";
export { AbortedError, UpstreamError } from "./providers/http";
export { LlmRouter, type Resolved } from "./providers/index";

/** 按文件路径读配置；示例配置找同目录的 config.example.json，密钥可以从环境变量读 */
export function configAt(
  path: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigService {
  return new ConfigService(new FileDocStore(dirname(path)), basename(path), env);
}

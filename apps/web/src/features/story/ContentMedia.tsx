import { type ContentMedia, isSafeContentMediaUrl } from "@cp/core";
import { Fragment, type ReactNode, useState } from "react";
import mediaStyles from "./content-media.module.css";

/** 内容中的同源素材跟随部署 base；不会把网络地址改写成可执行协议。 */
function mediaUrl(value: string | undefined): string | undefined {
  if (!value || !isSafeContentMediaUrl(value)) return undefined;
  if (!value.startsWith("/")) return value;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return base && (value === base || value.startsWith(`${base}/`)) ? value : `${base}${value}`;
}

/** 这些是站点播放页，不能当成视频文件或自行拼接成 iframe。 */
function isVideoPage(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  const parsed = new URL(value);
  if (/\.(?:mp4|webm|ogv|mov|m4v)$/i.test(parsed.pathname)) return false;
  const host = parsed.hostname.toLowerCase();
  return ["youtube.com", "youtu.be", "bilibili.com", "b23.tv", "vimeo.com", "douyin.com"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function MediaItem({ item }: { readonly item: ContentMedia }) {
  const [failed, setFailed] = useState(false);
  const url = mediaUrl(item.url);
  const videoPage = item.kind === "video" && !!url && isVideoPage(url);
  let body: ReactNode = null;
  if (url && !failed) {
    if (item.kind === "image") {
      body = (
        <a href={url} target="_blank" rel="noopener noreferrer" title={`查看原图：${item.label}`}>
          <img
            className={mediaStyles.image}
            src={url}
            alt={item.label}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </a>
      );
    } else if (item.kind === "video" && !videoPage) {
      body = (
        // biome-ignore lint/a11y/useMediaCaption: 只显示作品实际提供的字幕文件，不伪造缺失的字幕。
        <video
          className={mediaStyles.video}
          src={url}
          controls
          playsInline
          preload="none"
          poster={mediaUrl(item.poster)}
          aria-label={item.label}
          onError={() => setFailed(true)}
        >
          {mediaUrl(item.captionsUrl) && (
            <track kind="captions" src={mediaUrl(item.captionsUrl)} srcLang="zh" label="字幕" />
          )}
          浏览器不能播放这段视频，请打开原链接。
        </video>
      );
    } else if (item.kind === "audio") {
      body = (
        // biome-ignore lint/a11y/useMediaCaption: 录音的原文与说明在同一阅读片段中保留，不生成虚假字幕轨。
        <audio
          className={mediaStyles.audio}
          src={url}
          controls
          preload="none"
          aria-label={item.label}
          onError={() => setFailed(true)}
        >
          浏览器不能播放这段录音，请打开原链接。
        </audio>
      );
    }
  }
  return (
    <figure className={mediaStyles.item} data-kind={item.kind}>
      {body}
      <figcaption className={mediaStyles.caption}>
        <span className={mediaStyles.kind}>
          {{ link: "链接", image: "图片", video: "视频", audio: "录音" }[item.kind]}
        </span>
        {url ? (
          <a className={mediaStyles.link} href={url} target="_blank" rel="noopener noreferrer">
            {item.label} <span aria-hidden>↗</span>
          </a>
        ) : (
          <span>{item.label}</span>
        )}
      </figcaption>
      {item.caption && <p className={mediaStyles.note}>{item.caption}</p>}
      {videoPage && <p className={mediaStyles.note}>这是视频网页，请打开原链接播放。</p>}
      {(!url || failed) && (
        <p className={mediaStyles.error} role="status">
          {url ? "媒体暂时无法加载，原文和原链接仍可查看。" : "媒体地址不可用。"}
          {!url && <span className={mediaStyles.address}>{item.url}</span>}
        </p>
      )}
    </figure>
  );
}

/** 固定分段的媒体就地展示，播放器本身不触发游戏阅读、计时或交易。 */
export function ContentMediaList({ media }: { readonly media: readonly ContentMedia[] }) {
  if (!media.length) return null;
  return (
    <div className={mediaStyles.list}>
      {media.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 定稿媒体按固定顺序展示，重复地址也保留原来的位置。
        <MediaItem key={`${item.kind}:${item.url}:${index}`} item={item} />
      ))}
    </div>
  );
}

/** 只识别文字链接，其他文字与标记按原文呈现，不解析 HTML 或执行嵌入代码。 */
export function InlineContentText({ text }: { readonly text: string }) {
  const pieces: ReactNode[] = [];
  const pattern =
    /\[([^\]\r\n]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s<>"']+?)\)|(https?:\/\/[^\s<>"'，。；！？、）\]]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const position = match.index;
    pieces.push(text.slice(cursor, position));
    const raw = match[0];
    const target = match[2] ?? match[3] ?? "";
    const tail = match[3] ? (target.match(/[.,;!?)]+$/)?.[0] ?? "") : "";
    const clean = tail ? target.slice(0, -tail.length) : target;
    const url = mediaUrl(clean);
    pieces.push(
      <Fragment key={position}>
        {url ? (
          <a className={mediaStyles.link} href={url} target="_blank" rel="noopener noreferrer">
            {match[1] ?? clean}
          </a>
        ) : (
          raw.slice(0, tail ? -tail.length : undefined)
        )}
        {tail}
      </Fragment>,
    );
    cursor = position + raw.length;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}

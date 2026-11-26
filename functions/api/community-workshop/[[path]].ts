import { handleCommunityWorkshop } from "./core";
import { createD1WorkshopStore, type D1DatabaseLike } from "./d1";

interface WorkshopPagesEnv {
  readonly WORKSHOP_DB?: D1DatabaseLike;
  readonly WORKSHOP_ADMIN_TOKEN?: string;
}

interface WorkshopPagesContext {
  readonly request: Request;
  readonly env: WorkshopPagesEnv;
}

/** Cloudflare Pages Function：/api/community-workshop/* */
export const onRequest = async (context: WorkshopPagesContext): Promise<Response> => {
  const db = context.env.WORKSHOP_DB;
  if (!db) {
    return new Response(
      JSON.stringify({
        error:
          "社区工坊数据库（WORKSHOP_DB）尚未在 Cloudflare Pages 后台绑定，暂无法连接社区广场（本地导入与编辑仍可正常使用）。",
        code: "WORKSHOP_DB_UNBOUND",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
  const store = createD1WorkshopStore(db);
  return handleCommunityWorkshop(context.request, store, {
    adminToken: context.env.WORKSHOP_ADMIN_TOKEN,
    clientIp: context.request.headers.get("cf-connecting-ip") ?? undefined,
  });
};

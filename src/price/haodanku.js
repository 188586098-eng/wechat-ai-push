// 好单库 API 适配器（淘客选品数据源）
// 文档: https://www.haodanku.com/openapi/api_detail
// 精选低价包邮专区接口只需 apikey（应用中心免费获取），无需签名。
const BASE = 'http://v2.api.haodanku.com/low_price_Pinkage_data';

/**
 * 拉取精选低价商品（包邮好价）
 * @param {string} apikey 好单库应用中心获取的 Apikey
 * @param {object} opts
 *   type: 1=精选专区 2=9.9专区 3=6.9专区 4=3.9专区
 *   order: 1综合 2券后价高→低 3券后价低→高 4销量高→低
 *   back: 每页条数（1/2/5/10/20/50/100，默认10）
 * @returns {Promise<{list: object[], min_id: number}>}
 */
async function fetchDeals(apikey, opts = {}) {
  const params = new URLSearchParams({
    apikey,
    type: String(opts.type || 1),
    min_id: String(opts.min_id || 1),
    back: String(opts.back || 10),
    ...(opts.order ? { order: String(opts.order) } : {}),
  });
  const res = await fetch(`${BASE}?${params}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`好单库 HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 1 || !Array.isArray(json.data)) {
    throw new Error(`好单库接口失败: ${json.msg || JSON.stringify(json).slice(0, 120)}`);
  }
  // 过滤有效 itemid（数字），构造淘宝标准链接
  const list = json.data
    .filter((g) => /^\d{5,}$/.test(String(g.itemid || '')))
    .map((g) => ({
      itemid: String(g.itemid),
      title: g.itemtitle || '',
      shortTitle: g.itemshorttitle || '',
      desc: g.itemdesc || '',
      price: Number(g.itemprice), // 在售价
      couponPrice: Number(g.itemendprice), // 券后价
      sale: Number(g.itemsale || 0), // 月销量
      todaysale: Number(g.todaysale || 0),
      pic: g.itempic || '',
      shop: g.shopname || '',
      shopType: g.shoptype || '',
      couponInfo: g.couponinfo || '',
      url: `https://item.taobao.com/item.htm?id=${g.itemid}`,
    }));
  return { list, min_id: json.min_id };
}

module.exports = { fetchDeals };

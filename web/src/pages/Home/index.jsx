/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useContext, useEffect, useState } from 'react';
import { Button, Typography, Input, Tag, Table } from '@douyinfe/semi-ui';
import { API, showError, copy, showSuccess } from '../../helpers';
import { useIsMobile } from '../../hooks/common/useIsMobile';
import { StatusContext } from '../../context/Status';
import { useActualTheme } from '../../context/Theme';
import { marked } from 'marked';
import { useTranslation } from 'react-i18next';
import {
  IconPlay,
  IconCopy,
  IconCheckCircleStroked,
  IconTickCircle,
  IconShield,
  IconSend,
  IconCoinMoneyStroked,
  IconDescend,
  IconHelpCircle,
} from '@douyinfe/semi-icons';
import { Link } from 'react-router-dom';
import NoticeModal from '../../components/layout/NoticeModal';
import {
  OpenAI,
  Claude,
  Gemini,
  DeepSeek,
  Qwen,
  Minimax,
  Volcengine,
  Moonshot,
  Zhipu,
  XAI,
  Grok,
} from '@lobehub/icons';

const { Text, Title } = Typography;

// ======================================================================
// 定价配置（改价格只需改这里）
// ======================================================================
const SUBSCRIPTION_TIERS = [
  {
    id: 'trial',
    name: '新人特惠',
    price: 9.9,
    credit: 19.9,
    textDiscount: 0, // 不打折
    tag: '火爆热销',
    tagColor: 'orange',
    suitable: '个人试用 / 项目验证',
    ctaText: '立即领取',
  },
  {
    id: 'dev',
    name: '开发者版',
    price: 299,
    credit: 360,
    textDiscount: 50, // 5 折
    tag: '个人开发者',
    tagColor: 'blue',
    suitable: '独立开发者 / 个人项目',
    ctaText: '立即订阅',
  },
  {
    id: 'pro',
    name: '专业生产版',
    price: 499,
    credit: 650,
    textDiscount: 89,
    tag: '最具性价比',
    tagColor: 'violet',
    highlight: true, // 主推
    suitable: '全职开发 / 生产级应用',
    ctaText: '立即订阅',
  },
  {
    id: 'team',
    name: '旗舰团队版',
    price: 999,
    credit: 1400,
    textDiscount: 93,
    tag: '大额度首选',
    tagColor: 'amber',
    suitable: '开发团队 / AI 产品',
    ctaText: '立即订阅',
  },
];

// 订阅级文本模型对比（Pro 档折后价，仅限可订阅套利的模型）
const SUBSCRIPTION_MODEL_COMPARISON = [
  {
    model: 'GPT-5.4',
    official: '$2.50 / 1M',
    galapi: '$0.28 / 1M',
    save: '-89%',
  },
  {
    model: 'GPT-5.4-mini',
    official: '$0.75 / 1M',
    galapi: '$0.08 / 1M',
    save: '-89%',
  },
  {
    model: 'GPT-5.3-codex',
    official: '$1.75 / 1M',
    galapi: '$0.19 / 1M',
    save: '-89%',
  },
  {
    model: 'Claude Sonnet 4',
    official: '$3.00 / 1M',
    galapi: '$0.33 / 1M',
    save: '-89%',
  },
  {
    model: 'Claude Opus 4',
    official: '$15.00 / 1M',
    galapi: '$1.65 / 1M',
    save: '-89%',
  },
];

// 直连国内 API 的模型 (按官方价)
const DIRECT_MODEL_COMPARISON = [
  {
    model: 'DeepSeek V3',
    official: '$0.28 / 1M',
    galapi: '$0.28 / 1M',
    save: '官方价',
  },
  {
    model: 'Qwen3-Max',
    official: '¥2.4 / 1M',
    galapi: '¥2.4 / 1M',
    save: '官方价',
  },
  {
    model: 'MiniMax M2.7',
    official: '¥2.1 / 1M',
    galapi: '¥2.1 / 1M',
    save: '官方价',
  },
  {
    model: 'GLM-4',
    official: '¥0.5 / 1M',
    galapi: '¥0.5 / 1M',
    save: '官方价',
  },
];

// 5 核心竞争力
const CORE_FEATURES = [
  {
    icon: '🛡️',
    color: '#3b82f6',
    title: '稳定',
    desc: '多通道与智能切换机制，保障高峰期也可持续调用，业务不掉线',
  },
  {
    icon: '⚡',
    color: '#f59e0b',
    title: '极速',
    desc: '智能路由最优模型，缩短等待时间，输出更快，让创作和开发不被响应速度拖慢',
  },
  {
    icon: '💰',
    color: '#10b981',
    title: '节省',
    desc: '自研优化技术，文本生成成本最高可节省 60% Token，高频场景下效果尤为显著',
  },
  {
    icon: '📉',
    color: '#06b6d4',
    title: '价格优势',
    desc: '同等能力下更具性价比，无封号风险，按量计费，降低长期使用门槛',
  },
  {
    icon: '🎧',
    color: '#ec4899',
    title: '服务保障',
    desc: '完善文档、快速响应支持，7×24 专属客服，接入与上线更安心',
  },
];

// 首页数据亮点
const HERO_STATS = [
  { value: '50+', label: '支持模型' },
  { value: '2000+', label: 'C 端用户' },
  { value: '300+', label: '企业客户' },
  { value: '99.97%', label: 'API 可用性' },
];

// 视频模型价格（与官方同价/微加）
const VIDEO_MODEL_PRICING = [
  { model: 'Doubao Seedance 2.0', price: '¥1.05/秒', note: '1080p · 5-15秒' },
  {
    model: 'Doubao Seedance 2.0 Fast',
    price: '¥0.85/秒',
    note: '720p · 极速生成',
  },
  { model: 'Kling V2 Master', price: '¥X.XX/秒', note: '电影级品质' },
  { model: 'Kling V1.6', price: '¥X.XX/秒', note: '性价比选择' },
];

// 支持的模型 logo
const MODEL_PROVIDERS = [
  { Icon: OpenAI, name: 'OpenAI', color: true },
  { Icon: Claude, name: 'Claude', color: true },
  { Icon: Gemini, name: 'Gemini', color: true },
  { Icon: DeepSeek, name: 'DeepSeek', color: true },
  { Icon: Qwen, name: 'Qwen', color: true },
  { Icon: Minimax, name: 'MiniMax', color: true },
  { Icon: Volcengine, name: 'Volcengine', color: true },
  { Icon: Moonshot, name: 'Moonshot', color: false },
  { Icon: Zhipu, name: 'Zhipu', color: true },
  { Icon: XAI, name: 'XAI', color: false },
  { Icon: Grok, name: 'Grok', color: false },
];

// ======================================================================

const Home = () => {
  const { t } = useTranslation();
  const [statusState] = useContext(StatusContext);
  const actualTheme = useActualTheme();
  const [homePageContentLoaded, setHomePageContentLoaded] = useState(false);
  const [homePageContent, setHomePageContent] = useState('');
  const [noticeVisible, setNoticeVisible] = useState(false);
  const isMobile = useIsMobile();
  const serverAddress =
    statusState?.status?.server_address || `${window.location.origin}`;

  const displayHomePageContent = async () => {
    setHomePageContent(localStorage.getItem('home_page_content') || '');
    const res = await API.get('/api/home_page_content');
    const { success, message, data } = res.data;
    if (success) {
      let content = data;
      if (!data.startsWith('https://')) {
        content = marked.parse(data);
      }
      setHomePageContent(content);
      localStorage.setItem('home_page_content', content);

      if (data.startsWith('https://')) {
        const iframe = document.querySelector('iframe');
        if (iframe) {
          iframe.onload = () => {
            iframe.contentWindow.postMessage({ themeMode: actualTheme }, '*');
          };
        }
      }
    } else {
      showError(message);
      setHomePageContent('加载首页内容失败...');
    }
    setHomePageContentLoaded(true);
  };

  const handleCopyBaseURL = async () => {
    const ok = await copy(serverAddress);
    if (ok) {
      showSuccess('已复制到剪切板');
    }
  };

  useEffect(() => {
    const checkNoticeAndShow = async () => {
      const lastCloseDate = localStorage.getItem('notice_close_date');
      const today = new Date().toDateString();
      if (lastCloseDate !== today) {
        try {
          const res = await API.get('/api/notice');
          const { success, data } = res.data;
          if (success && data && data.trim() !== '') {
            setNoticeVisible(true);
          }
        } catch (error) {
          console.error('获取公告失败:', error);
        }
      }
    };

    checkNoticeAndShow();
  }, []);

  useEffect(() => {
    displayHomePageContent().then();
  }, []);

  return (
    <div className='w-full overflow-x-hidden'>
      <NoticeModal
        visible={noticeVisible}
        onClose={() => setNoticeVisible(false)}
        isMobile={isMobile}
      />
      {homePageContentLoaded && homePageContent === '' ? (
        <div className='w-full overflow-x-hidden'>
          {/* ======================== Hero Section (compact) ======================== */}
          <section className='w-full relative overflow-hidden py-10 md:py-14 lg:py-16 mt-4'>
            <div className='blur-ball blur-ball-indigo' />
            <div className='blur-ball blur-ball-teal' />

            <div className='max-w-5xl mx-auto px-6 text-center relative z-10'>
              <h1 className='text-3xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight'>
                Galapi{' '}
                <span className='shine-text'>AI 聚合网关</span>
              </h1>

              <p className='text-base md:text-lg text-semi-color-text-1 mb-2 max-w-3xl mx-auto'>
                文本 API 低至官方 1/10 · 视频 API 官方直连毫秒响应
              </p>

              <p className='text-sm text-semi-color-text-2 mb-6 max-w-2xl mx-auto'>
                一个接口，集成 GPT / Claude / Gemini / Seedance / Kling 等 50+ 主流 AI 模型
              </p>

              {/* BASE URL */}
              <div className='max-w-xl mx-auto mb-5'>
                <Input
                  readonly
                  value={serverAddress}
                  className='!rounded-full'
                  size={isMobile ? 'default' : 'large'}
                  suffix={
                    <Button
                      type='primary'
                      onClick={handleCopyBaseURL}
                      icon={<IconCopy />}
                      className='!rounded-full'
                    />
                  }
                />
              </div>

              {/* CTA buttons */}
              <div className='flex flex-row gap-4 justify-center items-center flex-wrap mb-8'>
                <Link to='/console'>
                  <Button
                    theme='solid'
                    type='primary'
                    size={isMobile ? 'default' : 'large'}
                    className='!rounded-3xl px-8 py-2'
                    icon={<IconPlay />}
                  >
                    立即开始
                  </Button>
                </Link>
                <Link to='/pricing'>
                  <Button
                    size={isMobile ? 'default' : 'large'}
                    className='!rounded-3xl px-8 py-2'
                  >
                    查看定价
                  </Button>
                </Link>
              </div>

              {/* Hero Stats - 4 numbers */}
              <div className='grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mt-10'>
                {HERO_STATS.map((stat, idx) => (
                  <div
                    key={idx}
                    className='rounded-2xl py-5 px-4 border border-semi-color-border'
                    style={{
                      backgroundColor: 'var(--semi-color-bg-0)',
                    }}
                  >
                    <div className='text-2xl md:text-3xl font-bold text-semi-color-primary mb-1'>
                      {stat.value}
                    </div>
                    <div className='text-sm text-semi-color-text-2'>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ======================== Why Choose Galapi (5 features) ======================== */}
          <section className='w-full py-16 md:py-20 border-t border-semi-color-border'>
            <div className='max-w-6xl mx-auto px-6'>
              <div className='text-center mb-12'>
                <Tag color='blue' size='large' className='mb-4'>
                  为什么选择 Galapi
                </Tag>
                <h2 className='text-3xl md:text-4xl font-bold mb-3'>
                  为什么开发者和创作者都选择 Galapi
                </h2>
                <p className='text-semi-color-text-1 text-lg'>
                  五大核心竞争力，让你的 AI 工作流更稳、更快、更省
                </p>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-5'>
                {CORE_FEATURES.map((feat, idx) => (
                  <div
                    key={idx}
                    className='flex flex-col p-6 rounded-2xl border border-semi-color-border transition-all hover:shadow-md hover:border-semi-color-primary'
                    style={{ backgroundColor: 'var(--semi-color-bg-0)' }}
                  >
                    <div
                      className='w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4'
                      style={{
                        backgroundColor: `${feat.color}20`,
                      }}
                    >
                      {feat.icon}
                    </div>
                    <Title heading={5} className='!mb-3'>
                      {feat.title}
                    </Title>
                    <Text
                      type='tertiary'
                      className='text-sm leading-relaxed'
                    >
                      {feat.desc}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ======================== Text API Subscriptions ======================== */}
          <section className='w-full py-16 md:py-24 border-t border-semi-color-border'>
            <div className='max-w-6xl mx-auto px-6'>
              <div className='text-center mb-12'>
                <Tag color='green' size='large' className='mb-4'>
                  🟢 文本 API · 订阅制
                </Tag>
                <h2 className='text-3xl md:text-4xl font-bold mb-3'>
                  比官方 API 便宜 <span className='text-semi-color-primary'>89%</span>
                </h2>
                <p className='text-semi-color-text-1 text-lg'>
                  4 档订阅套餐，所有档位解锁全部文本模型，越贵的档位每块钱买到的额度越多
                </p>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6'>
                {SUBSCRIPTION_TIERS.map((tier) => (
                  <div
                    key={tier.id}
                    className={`relative flex flex-col p-6 rounded-2xl border transition-all hover:shadow-lg ${
                      tier.highlight
                        ? 'border-semi-color-primary border-2 shadow-md'
                        : 'border-semi-color-border'
                    }`}
                    style={{
                      backgroundColor: 'var(--semi-color-bg-0)',
                    }}
                  >
                    {tier.highlight && (
                      <div className='absolute -top-3 left-1/2 transform -translate-x-1/2'>
                        <Tag color='violet' size='small'>
                          👑 主推
                        </Tag>
                      </div>
                    )}

                    {/* 套餐名 + 标签 */}
                    <div className='mb-4'>
                      <Tag color={tier.tagColor} size='small' className='mb-2'>
                        {tier.tag}
                      </Tag>
                      <Title heading={4} className='!mb-1'>
                        {tier.name}
                      </Title>
                      <Text
                        type='tertiary'
                        size='small'
                        className='!text-semi-color-text-2'
                      >
                        {tier.suitable}
                      </Text>
                    </div>

                    {/* 价格 */}
                    <div className='mb-4 pb-4 border-b border-semi-color-border'>
                      <div className='flex items-baseline gap-1'>
                        <span className='text-4xl font-bold'>¥{tier.price}</span>
                        <span className='text-semi-color-text-2'>/月</span>
                      </div>
                      <div className='mt-2'>
                        <span className='text-lg text-semi-color-primary font-semibold'>
                          到账 ${tier.credit}
                        </span>
                      </div>
                    </div>

                    {/* 卖点列表 */}
                    <ul className='space-y-3 mb-6 flex-grow text-sm'>
                      <li className='flex items-start gap-2'>
                        <IconTickCircle
                          style={{ color: 'var(--semi-color-primary)' }}
                          className='flex-shrink-0 mt-0.5'
                        />
                        <span>
                          文本模型{' '}
                          <strong className='text-semi-color-primary'>
                            {tier.textDiscount > 0
                              ? `${tier.textDiscount}% off`
                              : '无折扣'}
                          </strong>
                        </span>
                      </li>
                      <li className='flex items-start gap-2'>
                        <IconTickCircle
                          style={{ color: 'var(--semi-color-primary)' }}
                          className='flex-shrink-0 mt-0.5'
                        />
                        <span>视频模型按官方价计费</span>
                      </li>
                      <li className='flex items-start gap-2'>
                        <IconTickCircle
                          style={{ color: 'var(--semi-color-primary)' }}
                          className='flex-shrink-0 mt-0.5'
                        />
                        <span>解锁全部 30+ 模型</span>
                      </li>
                      <li className='flex items-start gap-2'>
                        <IconTickCircle
                          style={{ color: 'var(--semi-color-primary)' }}
                          className='flex-shrink-0 mt-0.5'
                        />
                        <span>月度自动重置额度</span>
                      </li>
                    </ul>

                    {/* CTA */}
                    <Link to='/console/topup'>
                      <Button
                        theme={tier.highlight ? 'solid' : 'light'}
                        type='primary'
                        size='large'
                        className='w-full !rounded-full'
                      >
                        {tier.ctaText}
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>

              {/* 订阅级模型对比表 (89% off) */}
              <div className='mt-16'>
                <div className='text-center mb-8'>
                  <Title heading={3}>订阅级模型 · 省 89%</Title>
                  <Text type='tertiary'>
                    订阅制套餐下的 OpenAI / Anthropic 模型（以 Pro 档为例）
                  </Text>
                </div>

                <div className='max-w-3xl mx-auto overflow-x-auto rounded-xl border border-semi-color-border'>
                  <table className='w-full'>
                    <thead>
                      <tr
                        style={{
                          backgroundColor: 'var(--semi-color-fill-0)',
                        }}
                      >
                        <th className='text-left p-4 font-semibold'>模型</th>
                        <th className='text-right p-4 font-semibold'>官方价</th>
                        <th className='text-right p-4 font-semibold'>Galapi Pro</th>
                        <th className='text-right p-4 font-semibold'>节省</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SUBSCRIPTION_MODEL_COMPARISON.map((row, idx) => (
                        <tr
                          key={idx}
                          className='border-t border-semi-color-border'
                        >
                          <td className='p-4 font-medium'>{row.model}</td>
                          <td className='p-4 text-right text-semi-color-text-2 line-through'>
                            {row.official}
                          </td>
                          <td className='p-4 text-right font-semibold text-semi-color-primary'>
                            {row.galapi}
                          </td>
                          <td className='p-4 text-right'>
                            <Tag color='green' size='small'>
                              {row.save}
                            </Tag>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 直连国内 API 模型 */}
              <div className='mt-12'>
                <div className='text-center mb-8'>
                  <Title heading={3}>直连模型 · 官方价</Title>
                  <Text type='tertiary'>
                    DeepSeek / Qwen / MiniMax 等，直连官方 API，合规稳定
                  </Text>
                </div>

                <div className='max-w-3xl mx-auto overflow-x-auto rounded-xl border border-semi-color-border'>
                  <table className='w-full'>
                    <thead>
                      <tr
                        style={{
                          backgroundColor: 'var(--semi-color-fill-0)',
                        }}
                      >
                        <th className='text-left p-4 font-semibold'>模型</th>
                        <th className='text-right p-4 font-semibold'>官方价</th>
                        <th className='text-right p-4 font-semibold'>Galapi 价</th>
                        <th className='text-right p-4 font-semibold'>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DIRECT_MODEL_COMPARISON.map((row, idx) => (
                        <tr
                          key={idx}
                          className='border-t border-semi-color-border'
                        >
                          <td className='p-4 font-medium'>{row.model}</td>
                          <td className='p-4 text-right text-semi-color-text-2'>
                            {row.official}
                          </td>
                          <td className='p-4 text-right font-semibold'>
                            {row.galapi}
                          </td>
                          <td className='p-4 text-right'>
                            <Tag color='blue' size='small'>
                              {row.save}
                            </Tag>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* ======================== Video API ======================== */}
          <section className='w-full py-16 md:py-24 border-t border-semi-color-border'>
            <div className='max-w-5xl mx-auto px-6'>
              <div className='text-center mb-12'>
                <Tag color='violet' size='large' className='mb-4'>
                  🎬 视频 API · 按量付费
                </Tag>
                <h2 className='text-3xl md:text-4xl font-bold mb-3'>
                  官方直连 · <span className='text-semi-color-primary'>毫秒响应</span>
                </h2>
                <p className='text-semi-color-text-1 text-lg max-w-2xl mx-auto'>
                  视频模型直接对接官方 API，无订阅池中转，无排队降质。用多少付多少。
                </p>
              </div>

              {/* 视频价格表 */}
              <div className='max-w-3xl mx-auto overflow-x-auto rounded-xl border border-semi-color-border mb-12'>
                <table className='w-full'>
                  <thead>
                    <tr
                      style={{ backgroundColor: 'var(--semi-color-fill-0)' }}
                    >
                      <th className='text-left p-4 font-semibold'>模型</th>
                      <th className='text-right p-4 font-semibold'>价格</th>
                      <th className='text-right p-4 font-semibold'>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VIDEO_MODEL_PRICING.map((row, idx) => (
                      <tr
                        key={idx}
                        className='border-t border-semi-color-border'
                      >
                        <td className='p-4 font-medium'>{row.model}</td>
                        <td className='p-4 text-right font-semibold text-semi-color-primary'>
                          {row.price}
                        </td>
                        <td className='p-4 text-right text-semi-color-text-2 text-sm'>
                          {row.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 视频卖点 */}
              <div className='grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto'>
                <div className='text-center p-6'>
                  <div className='text-3xl mb-3'>⚡</div>
                  <Title heading={5}>官方直连</Title>
                  <Text type='tertiary'>不经过中转，无订阅池</Text>
                </div>
                <div className='text-center p-6'>
                  <div className='text-3xl mb-3'>🎨</div>
                  <Title heading={5}>全参数支持</Title>
                  <Text type='tertiary'>分辨率/时长/宽高比任选</Text>
                </div>
                <div className='text-center p-6'>
                  <div className='text-3xl mb-3'>💨</div>
                  <Title heading={5}>秒级提交</Title>
                  <Text type='tertiary'>任务响应与官方一致</Text>
                </div>
              </div>
            </div>
          </section>

          {/* ======================== Unified Billing Explanation ======================== */}
          <section className='w-full py-16 md:py-20 border-t border-semi-color-border'>
            <div className='max-w-4xl mx-auto px-6'>
              <div className='text-center mb-8'>
                <Title heading={3}>💡 两种计费，一个余额</Title>
                <Text type='tertiary' className='text-base'>
                  订阅后一次充值，所有模型共用一个额度池
                </Text>
              </div>

              <div
                className='rounded-2xl p-8 border border-semi-color-border'
                style={{ backgroundColor: 'var(--semi-color-fill-0)' }}
              >
                <div className='font-mono text-sm space-y-2'>
                  <div>
                    <span className='text-semi-color-primary'>订阅专业生产版 ¥499</span>
                    <span className='text-semi-color-text-2'>
                      {' '}
                      → 账户余额 $650.00
                    </span>
                  </div>
                  <div className='text-semi-color-text-2'>│</div>
                  <div>
                    <span>调用 1M tokens GPT-5.4</span>
                    <span className='text-semi-color-primary'> → 扣 $0.28</span>
                    <span className='text-semi-color-text-2'> (89% off)</span>
                  </div>
                  <div>
                    <span>调用 10 秒 Seedance 2.0</span>
                    <span className='text-semi-color-primary'> → 扣 $1.44</span>
                    <span className='text-semi-color-text-2'> (官方价)</span>
                  </div>
                  <div className='text-semi-color-text-2'>│</div>
                  <div>
                    <span className='text-semi-color-primary'>余额 $648.28</span>
                    <span className='text-semi-color-text-2'>
                      {' '}
                      可继续调用，下月自动重置
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ======================== Model Providers ======================== */}
          <section className='w-full py-16 md:py-20 border-t border-semi-color-border'>
            <div className='max-w-5xl mx-auto px-6 text-center'>
              <Title heading={3} className='!mb-8'>
                支持的模型供应商
              </Title>
              <div className='flex flex-wrap items-center justify-center gap-6 md:gap-10'>
                {MODEL_PROVIDERS.map((provider, idx) => {
                  const Icon = provider.color && provider.Icon.Color
                    ? provider.Icon.Color
                    : provider.Icon;
                  return (
                    <div
                      key={idx}
                      className='w-12 h-12 flex items-center justify-center opacity-75 hover:opacity-100 transition-opacity'
                      title={provider.name}
                    >
                      <Icon size={40} />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className='overflow-x-hidden w-full'>
          {homePageContent.startsWith('https://') ? (
            <iframe
              src={homePageContent}
              className='w-full h-screen border-none'
            />
          ) : (
            <div
              className='mt-[60px]'
              dangerouslySetInnerHTML={{ __html: homePageContent }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default Home;

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

import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography } from '@douyinfe/semi-ui';
import { getFooterHTML, getSystemName } from '../../helpers';

const FooterBar = () => {
  const { t } = useTranslation();
  const [footer, setFooter] = useState(getFooterHTML());
  const systemName = getSystemName();

  const loadFooter = () => {
    let footer_html = localStorage.getItem('footer_html');
    if (footer_html) {
      setFooter(footer_html);
    }
  };

  const currentYear = new Date().getFullYear();

  const customFooter = useMemo(
    () => (
      <footer className='relative h-auto py-8 px-6 md:px-24 w-full flex flex-col items-center justify-between overflow-hidden'>
        <div className='flex flex-col md:flex-row items-center justify-between w-full max-w-[1110px] gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Typography.Text className='text-base font-medium !text-semi-color-text-0'>
              © {currentYear} {systemName}. {t('版权所有')}
            </Typography.Text>
          </div>

          <div className='text-xs opacity-60'>
            <span className='!text-semi-color-text-2'>
              {t('设计与开发由')}{' '}
            </span>
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
              className='!text-semi-color-text-2'
            >
              New API
            </a>
          </div>
        </div>
      </footer>
    ),
    [systemName, t, currentYear],
  );

  useEffect(() => {
    loadFooter();
  }, []);

  return (
    <div className='w-full'>
      {footer ? (
        <footer className='relative h-auto py-4 px-6 md:px-24 w-full flex items-center justify-center overflow-hidden'>
          <div className='flex flex-col md:flex-row items-center justify-between w-full max-w-[1110px] gap-4'>
            <div
              className='custom-footer na-cb6feafeb3990c78 text-sm !text-semi-color-text-1'
              dangerouslySetInnerHTML={{ __html: footer }}
            ></div>
            <div className='text-sm flex-shrink-0'>
              <span className='!text-semi-color-text-1'>
                {t('设计与开发由')}{' '}
              </span>
              <a
                href='https://github.com/QuantumNous/new-api'
                target='_blank'
                rel='noopener noreferrer'
                className='!text-semi-color-primary font-medium'
              >
                New API
              </a>
            </div>
          </div>
        </footer>
      ) : (
        customFooter
      )}
    </div>
  );
};

export default FooterBar;

import React from 'react';

interface ScoreGaugeProps {
  score: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  color: string;
  bgColor: string;
}

export const ScoreGauge: React.FC<ScoreGaugeProps> = ({
  score,
  label,
  size = 'md',
  color,
  bgColor,
}) => {
  const dims = { sm: 80, md: 110, lg: 150 };
  const dim = dims[size];
  const radius = (dim - 16) / 2;
  const cx = dim / 2;
  const cy = dim / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  const gap = circumference - dash;

  const textSize = size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-2xl' : 'text-lg';
  const labelSize = size === 'lg' ? 'text-sm' : 'text-xs';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg width={dim} height={dim} className="-rotate-90">
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={bgColor}
            strokeWidth={size === 'lg' ? 10 : 8}
          />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={size === 'lg' ? 10 : 8}
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold ${textSize} leading-none`} style={{ color }}>
            {score}
          </span>
        </div>
      </div>
      <span className={`${labelSize} font-medium text-slate-400 text-center`}>{label}</span>
    </div>
  );
};

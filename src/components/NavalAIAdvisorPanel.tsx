/**
 * NavalAIAdvisorPanel - LLM 战术顾问面板
 * 显示 AI 战术建议 + 命令输入
 */

import React, { useState } from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalAIAdvisorPanel() {
  const {
    aiConfig,
    aiAdvice,
    aiLoading,
    aiError,
    requestAIAdvice,
    submitACommand,
    currentTurn,
  } = useNavalStore();

  const [commandInput, setCommandInput] = useState('');
  const [commandResult, setCommandResult] = useState<string>('');
  const [commandLoading, setCommandLoading] = useState(false);

  const handleAskAdvice = () => {
    requestAIAdvice();
  };

  const handleSubmitCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    setCommandLoading(true);
    setCommandResult('');
    try {
      const result = await submitACommand(commandInput);
      if (result) {
        setCommandResult(
          result.parsed
            ? `[${result.intent}] ${result.explanation}`
            : result.explanation || '无法解析命令'
        );
      } else {
        setCommandResult('命令执行失败');
      }
    } catch {
      setCommandResult('命令解析错误');
    }
    setCommandLoading(false);
    setCommandInput('');
  };

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <span className="font-bold text-blue-400">
          AI Advisor
        </span>
        <span className="text-gray-500 text-[10px]">
          {aiConfig.kind === 'deepseek' ? 'DeepSeek' : 'Rule-based'}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-3">
        {/* Ask button */}
        <button
          onClick={handleAskAdvice}
          disabled={aiLoading}
          className="w-full py-2 px-3 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm font-semibold transition-colors"
        >
          {aiLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
              Analyzing...
            </span>
          ) : (
            'Request AI Advice'
          )}
        </button>

        {/* Error */}
        {aiError && (
          <div className="p-2 bg-red-900/30 border border-red-800 rounded text-red-400 text-[10px]">
            {aiError}
          </div>
        )}

        {/* Advice */}
        {aiAdvice && (
          <div className="space-y-2">
            {/* Situation */}
            <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
              <div className="text-gray-500 uppercase text-[9px] mb-1">Situation (T{currentTurn})</div>
              <div className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                {aiAdvice.situationAssessment}
              </div>
            </div>

            {/* Risk */}
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-[9px] uppercase">Risk Level:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                aiAdvice.riskLevel === 'high' ? 'bg-red-900/50 text-red-400' :
                aiAdvice.riskLevel === 'medium' ? 'bg-yellow-900/50 text-yellow-400' :
                'bg-green-900/50 text-green-400'
              }`}>
                {aiAdvice.riskLevel.toUpperCase()}
              </span>
            </div>

            {/* Recommendations */}
            {aiAdvice.recommendations.length > 0 && (
              <div>
                <div className="text-gray-500 uppercase text-[9px] mb-1">Recommendations</div>
                {aiAdvice.recommendations.map((rec, i) => (
                  <div key={i} className={`p-1.5 mb-1 rounded border text-[10px] ${
                    rec.priority === 'high' ? 'border-red-800/50 bg-red-950/20' :
                    rec.priority === 'medium' ? 'border-yellow-800/50 bg-yellow-950/20' :
                    'border-gray-800 bg-gray-900/30'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        rec.priority === 'high' ? 'bg-red-400' : rec.priority === 'medium' ? 'bg-yellow-400' : 'bg-gray-400'
                      }`} />
                      <span className="text-gray-200">{rec.action}</span>
                    </div>
                    <div className="text-gray-500 mt-0.5 ml-3">{rec.reasoning}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Suggested Commands */}
            {aiAdvice.suggestedCommands.length > 0 && (
              <div>
                <div className="text-gray-500 uppercase text-[9px] mb-1">Suggested Commands</div>
                {aiAdvice.suggestedCommands.map((cmd, i) => (
                  <div key={i} className="p-1.5 mb-1 rounded bg-blue-950/20 border border-blue-900/30 text-[10px]">
                    <span className="text-blue-300">{cmd.command}</span>
                    <span className="text-gray-500 ml-2">[{cmd.type}]</span>
                    {cmd.fleetId && (
                      <span className="text-gray-600 ml-1">→ {cmd.fleetId}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="border-t border-gray-700 pt-2 mt-2">
          <div className="text-gray-500 uppercase text-[9px] mb-1">Voice Command (AI Parsed)</div>
          <form onSubmit={handleSubmitCommand} className="flex gap-1">
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="e.g. 搜索敌方舰队 / Launch strike / 撤退航母"
              className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600"
            />
            <button
              type="submit"
              disabled={commandLoading || !commandInput.trim()}
              className="px-2 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-xs"
            >
              {commandLoading ? '...' : 'Send'}
            </button>
          </form>
          {commandResult && (
            <div className="mt-1 p-1.5 bg-gray-800/50 rounded text-[10px] text-green-400">
              {commandResult}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

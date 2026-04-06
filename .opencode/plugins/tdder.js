/**
 * tdder plugin for OpenCode.
 *
 * Registers skills and agents so OpenCode discovers them
 * without requiring manual symlinks or config file edits.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TdderPlugin = async () => {
  const skillsDir = path.resolve(__dirname, '../../skills');
  const agentsDir = path.resolve(__dirname, '../agents');

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }

      config.agent = config.agent || {};
      if (!config.agent['clean-code-reviewer']) {
        const agentFile = path.join(agentsDir, 'clean-code-reviewer.md');
        const content = fs.readFileSync(agentFile, 'utf8');
        const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
        if (match) {
          config.agent['clean-code-reviewer'] = {
            description:
              'Autonomous clean code review agent that analyzes code against clean code principles and returns prioritized refactoring suggestions.',
            mode: 'subagent',
            color: 'success',
            prompt: match[1].trim(),
            permission: {
              edit: 'deny',
              bash: 'deny',
            },
          };
        }
      }
    },
  };
};

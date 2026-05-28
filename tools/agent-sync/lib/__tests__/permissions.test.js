import {
  collectSkillPermissions,
  mergeSkillPermissions,
  syncSkillPermissions
} from '../permissions.js';

const enoent = () => {
  const err = new Error('ENOENT');
  err.code = 'ENOENT';
  return err;
};

const skillMd = (name, allowedTools) => {
  const tools = allowedTools
    ? '\nallowed-tools:\n' + allowedTools.map((t) => `  - ${t}`).join('\n')
    : '';
  return `---\nname: ${name}${tools}\n---\n# ${name}\nbody`;
};

describe('permissions module', () => {
  describe('collectSkillPermissions', () => {
    test('should emit Skill(name) for each skill', async () => {
      const readFile = async () => skillMd('whatever');
      const result = await collectSkillPermissions('/skills', ['alpha', 'beta'], { readFile });

      expect(result).toContain('Skill(alpha)');
      expect(result).toContain('Skill(beta)');
    });

    test('should cascade allowed-tools entries from SKILL.md frontmatter', async () => {
      const readFile = async (filePath) => {
        if (filePath === '/skills/alpha/SKILL.md') {
          return skillMd('alpha', ['Read', 'Bash(summarize:*)']);
        }
        return skillMd('beta');
      };

      const result = await collectSkillPermissions('/skills', ['alpha', 'beta'], { readFile });

      expect(result).toEqual([
        'Skill(alpha)',
        'Read',
        'Bash(summarize:*)',
        'Skill(beta)'
      ]);
    });

    test('should handle a skill with no allowed-tools', async () => {
      const readFile = async () => skillMd('solo');
      const result = await collectSkillPermissions('/skills', ['solo'], { readFile });

      expect(result).toEqual(['Skill(solo)']);
    });

    test('should skip a skill whose SKILL.md is missing', async () => {
      const readFile = async () => {
        throw enoent();
      };
      const result = await collectSkillPermissions('/skills', ['ghost'], { readFile });

      expect(result).toEqual(['Skill(ghost)']);
    });

    test('should deduplicate repeated permission entries', async () => {
      const readFile = async () => skillMd('any', ['Bash(git:*)']);
      const result = await collectSkillPermissions('/skills', ['one', 'two'], { readFile });

      expect(result.filter((e) => e === 'Bash(git:*)')).toHaveLength(1);
    });

    test('should rethrow non-ENOENT read errors', async () => {
      const readFile = async () => {
        throw new Error('Permission denied');
      };
      await expect(
        collectSkillPermissions('/skills', ['x'], { readFile })
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('mergeSkillPermissions', () => {
    test('should create permissions.allow when settings is empty', () => {
      const result = mergeSkillPermissions({}, ['Skill(a)', 'Skill(b)']);

      expect(result.settings.permissions.allow).toEqual(['Skill(a)', 'Skill(b)']);
      expect(result.added).toEqual(['Skill(a)', 'Skill(b)']);
      expect(result.removed).toEqual([]);
    });

    test('should append to an existing permissions.allow and dedup', () => {
      const settings = { permissions: { allow: ['Skill(a)', 'Bash(ls:*)'] } };
      const result = mergeSkillPermissions(settings, ['Skill(a)', 'Skill(b)']);

      expect(result.settings.permissions.allow).toEqual([
        'Skill(a)',
        'Bash(ls:*)',
        'Skill(b)'
      ]);
      expect(result.added).toEqual(['Skill(b)']);
    });

    test('should preserve other settings fields', () => {
      const settings = {
        model: 'opus',
        permissions: { deny: ['Bash(rm:*)'], allow: ['Skill(a)'] }
      };
      const result = mergeSkillPermissions(settings, ['Skill(b)']);

      expect(result.settings.model).toBe('opus');
      expect(result.settings.permissions.deny).toEqual(['Bash(rm:*)']);
      expect(result.settings.permissions.allow).toEqual(['Skill(a)', 'Skill(b)']);
    });

    test('should prune orphaned previously-added entries when clean', () => {
      const settings = { permissions: { allow: ['Skill(a)', 'Skill(gone)'] } };
      const result = mergeSkillPermissions(
        settings,
        ['Skill(a)'],
        ['Skill(a)', 'Skill(gone)'],
        { clean: true }
      );

      expect(result.settings.permissions.allow).toEqual(['Skill(a)']);
      expect(result.removed).toEqual(['Skill(gone)']);
    });

    test('should not remove user-added entries on clean', () => {
      const settings = { permissions: { allow: ['Skill(a)', 'Bash(mine:*)'] } };
      // Bash(mine:*) was never placed by agent-sync (not in previouslyAdded)
      const result = mergeSkillPermissions(
        settings,
        ['Skill(a)'],
        ['Skill(a)'],
        { clean: true }
      );

      expect(result.settings.permissions.allow).toContain('Bash(mine:*)');
      expect(result.removed).toEqual([]);
    });

    test('should leave orphans in place when clean is not set', () => {
      const settings = { permissions: { allow: ['Skill(gone)'] } };
      const result = mergeSkillPermissions(settings, ['Skill(a)'], ['Skill(gone)']);

      expect(result.settings.permissions.allow).toEqual(['Skill(gone)', 'Skill(a)']);
      expect(result.removed).toEqual([]);
    });
  });

  describe('syncSkillPermissions', () => {
    const baseDeps = {
      getClaudeConfigDir: () => '/home/.claude',
      getSkillsDirectory: () => '/merged/skills',
      collectSkillPermissions: async () => ['Skill(a)', 'Bash(git:*)'],
      loadPermissionsState: async () => ({}),
      savePermissionsState: async () => {}
    };

    test('should return null for a non-claude-code target', async () => {
      const deps = { ...baseDeps, getClaudeConfigDir: () => null };
      const result = await syncSkillPermissions({}, 'codex', ['a'], {}, deps);

      expect(result).toBeNull();
    });

    test('should create settings.json when absent', async () => {
      let writtenPath = null;
      let writtenContent = null;
      const deps = {
        ...baseDeps,
        readFile: async () => {
          throw enoent();
        },
        writeFile: async (p, content) => {
          writtenPath = p;
          writtenContent = content;
        }
      };

      const result = await syncSkillPermissions({}, 'claude-code', ['a'], {}, deps);

      expect(writtenPath).toBe('/home/.claude/settings.json');
      expect(JSON.parse(writtenContent).permissions.allow).toEqual([
        'Skill(a)',
        'Bash(git:*)'
      ]);
      expect(result.added).toEqual(['Skill(a)', 'Bash(git:*)']);
    });

    test('should merge into an existing settings.json', async () => {
      let writtenContent = null;
      const deps = {
        ...baseDeps,
        readFile: async () =>
          JSON.stringify({ model: 'opus', permissions: { allow: ['Skill(a)'] } }),
        writeFile: async (_p, content) => {
          writtenContent = content;
        }
      };

      await syncSkillPermissions({}, 'claude-code', ['a'], {}, deps);

      const parsed = JSON.parse(writtenContent);
      expect(parsed.model).toBe('opus');
      expect(parsed.permissions.allow).toEqual(['Skill(a)', 'Bash(git:*)']);
    });

    test('should track placed entries in permissions state', async () => {
      let savedState = null;
      const deps = {
        ...baseDeps,
        readFile: async () => {
          throw enoent();
        },
        writeFile: async () => {},
        savePermissionsState: async (_cfg, state) => {
          savedState = state;
        }
      };

      await syncSkillPermissions({}, 'claude-code:work', ['a'], {}, deps);

      expect(savedState['claude-code:work']).toEqual(['Skill(a)', 'Bash(git:*)']);
    });

    test('should prune orphans using previous state on clean', async () => {
      let writtenContent = null;
      const deps = {
        ...baseDeps,
        collectSkillPermissions: async () => ['Skill(a)'],
        loadPermissionsState: async () => ({
          'claude-code': ['Skill(a)', 'Skill(gone)']
        }),
        readFile: async () =>
          JSON.stringify({ permissions: { allow: ['Skill(a)', 'Skill(gone)'] } }),
        writeFile: async (_p, content) => {
          writtenContent = content;
        }
      };

      const result = await syncSkillPermissions({}, 'claude-code', ['a'], { clean: true }, deps);

      expect(JSON.parse(writtenContent).permissions.allow).toEqual(['Skill(a)']);
      expect(result.removed).toEqual(['Skill(gone)']);
    });

    test('should not write anything in dry-run mode', async () => {
      let wrote = false;
      let stateSaved = false;
      const deps = {
        ...baseDeps,
        readFile: async () => {
          throw enoent();
        },
        writeFile: async () => {
          wrote = true;
        },
        savePermissionsState: async () => {
          stateSaved = true;
        }
      };

      const result = await syncSkillPermissions({}, 'claude-code', ['a'], { dryRun: true }, deps);

      expect(wrote).toBe(false);
      expect(stateSaved).toBe(false);
      expect(result.added).toEqual(['Skill(a)', 'Bash(git:*)']);
    });
  });
});

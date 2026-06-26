import type { Config } from '../config/schema';
import type { MemoryStore } from '../memory/MemoryStore';
import { DiskBackedStorage } from '../memory/DiskBackedStorage';
import { AzureBlobStorage } from '../memory/AzureBlobStorage';
import { InMemoryStorage } from '../memory/InMemoryStorage';
import { AgentMemory } from '../memory/AgentMemory';

import type { LlmAdapter } from '../llm/LlmAdapter';
import { AzureFoundryAdapter } from '../llm/AzureFoundryAdapter';
import { FoundryLocalAdapter } from '../llm/FoundryLocalAdapter';
import { GitHubCopilotCliAdapter } from '../llm/GitHubCopilotCliAdapter';
import { FakeLlmAdapter } from '../llm/fakes/FakeLlmAdapter';
import { Planner } from '../llm/Planner';
import { buildMcpServers } from '../mcp/McpConfig';
import { McpClientPool } from '../mcp/McpClientPool';
import type { McpToolProvider } from '../mcp/McpToolProvider';

import type { WorkTrackingConnector } from '../worktracking/WorkTrackingConnector';
import { JiraConnector } from '../worktracking/jira/JiraConnector';
import { JiraClient } from '../worktracking/jira/JiraClient';

import type { AgentConnector } from '../agents/AgentConnector';
import { GitHubCopilotAgentConnector } from '../agents/GitHubCopilotAgentConnector';
import { InMemoryAgentConnector } from '../agents/fakes/InMemoryAgentConnector';

import type { CommunicationAdapter } from '../comms/CommunicationAdapter';
import { ConsoleCommunicationAdapter } from '../comms/ConsoleCommunicationAdapter';
import { TeamsCommunicationAdapter } from '../comms/TeamsCommunicationAdapter';
import { SlackCommunicationAdapter } from '../comms/SlackCommunicationAdapter';
import { CompositeCommunicationAdapter } from '../comms/CompositeCommunicationAdapter';

import { Orchestrator } from '../orchestrator/Orchestrator';
import { Poller } from '../orchestrator/Poller';
import { Reconciler } from '../orchestrator/Reconciler';

export interface BuiltSystem {
  config: Config;
  memory: AgentMemory;
  connectors: WorkTrackingConnector[];
  agent: AgentConnector;
  llm: LlmAdapter;
  planner: Planner;
  comms: CommunicationAdapter;
  orchestrator: Orchestrator;
  poller: Poller;
  reconciler: Reconciler;
  /** MCP tool provider, when any MCP servers are configured. */
  mcp?: McpToolProvider;
}

/** Wire all adapters and the orchestrator/poller from validated config. */
export function buildFromConfig(config: Config): BuiltSystem {
  const memory = new AgentMemory(buildMemoryStore(config));
  const mcpServers = buildMcpServers(config.mcp);
  const mcp = mcpServers.length > 0 ? new McpClientPool(mcpServers) : undefined;
  const llm = buildLlm(config, mcp);
  const planner = new Planner(llm, mcpServers, { githubOwner: config.agent.github.owner });
  const connectors = buildConnectors(config);
  const agent = buildAgent(config, mcp);
  const comms = buildComms(config);

  const orchestrator = new Orchestrator({ connectors, planner, agent, memory, comms });
  const poller = new Poller({ connectors, agent, memory, comms });
  const reconciler = new Reconciler({ connectors, agent, memory, comms });

  return { config, memory, connectors, agent, llm, planner, comms, orchestrator, poller, reconciler, mcp };
}

function buildMemoryStore(config: Config): MemoryStore {
  switch (config.memory.type) {
    case 'disk':
      return new DiskBackedStorage(config.memory.directory);
    case 'azure':
      return new AzureBlobStorage({
        connectionString: config.memory.azure?.connectionString,
        container: config.memory.azure?.container ?? 'osa-memory',
      });
    case 'memory':
      return new InMemoryStorage();
  }
}

function buildLlm(config: Config, toolProvider?: McpToolProvider): LlmAdapter {
  switch (config.llm.provider) {
    case 'azure-foundry':
      return new AzureFoundryAdapter(config.llm);
    case 'foundry-local':
      return new FoundryLocalAdapter(config.llm, { toolProvider });
    case 'github-copilot-cli':
      return new GitHubCopilotCliAdapter(config.llm);
    case 'fake':
      return new FakeLlmAdapter();
  }
}

function buildConnectors(config: Config): WorkTrackingConnector[] {
  const connectors: WorkTrackingConnector[] = [];
  if (config.jira) {
    const client = new JiraClient({
      baseUrl: config.jira.baseUrl,
      email: config.jira.email,
      apiToken: config.jira.apiToken,
    });
    connectors.push(new JiraConnector(config.jira, client));
  }
  return connectors;
}

function buildAgent(config: Config, mcp?: McpToolProvider): AgentConnector {
  switch (config.agent.provider) {
    case 'github-copilot':
      return new GitHubCopilotAgentConnector({
        token: config.agent.github.token,
        assignee: config.agent.github.assignee,
        mcp,
      });
    case 'fake':
      return new InMemoryAgentConnector();
  }
}

function buildComms(config: Config): CommunicationAdapter {
  const adapters: CommunicationAdapter[] = config.comms.map((comm) => {
    switch (comm.type) {
      case 'console':
        return new ConsoleCommunicationAdapter();
      case 'teams':
        return new TeamsCommunicationAdapter({ webhookUrl: comm.webhookUrl, channel: comm.channel });
      case 'slack':
        return new SlackCommunicationAdapter({ webhookUrl: comm.webhookUrl, channel: comm.channel });
    }
  });
  return new CompositeCommunicationAdapter(adapters);
}

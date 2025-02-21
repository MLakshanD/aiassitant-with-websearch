'use client'

import React from 'react'
import { useChat } from 'ai/react'

export default function Chat() {
  const [streamContent, setStreamContent] = React.useState('')
  
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
    onResponse: (response) => {
      if (!response.ok) {
        console.error('Stream response error:', response.statusText)
        return
      }
      setStreamContent('')
      let text = ''
      
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        const readStream = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value)
              const lines = chunk.split('\n')
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const content = line.slice(6)
                  if (content !== '[DONE]') {
                    const lastChar = text[text.length - 1]
                    const firstChar = content[0]
                    
                    const needsSpace = text.length > 0 && 
                                     /[a-zA-Z0-9]/.test(lastChar) && 
                                     /[a-zA-Z0-9]/.test(firstChar)
                    
                    text += (needsSpace ? ' ' : '') + content
                    setStreamContent(text)
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error reading stream:', error)
          }
        }
        readStream()
      }
    },
    onFinish: () => {
      setStreamContent('')
    }
  })

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamContent])

  return (
    <div className="flex flex-col h-screen bg-gradient-to-b from-gray-900 to-gray-800">
      {/* Header */}
      <div className="border-b border-gray-700/50 bg-gray-900/90 backdrop-blur-md p-6 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="h-3 w-3 bg-indigo-500 rounded-full animate-pulse"/>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            AI Assistant
          </h1>
        </div>
      </div>

      {/* Chat messages wrapped in a fieldset */}
      <fieldset className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent border-2 border-gray-700 rounded-2xl mx-4 p-4 bg-gray-900/80">
        <legend className="text-lg font-bold text-gray-100">Chat Area</legend>
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="text-gray-400 text-sm">Start a conversation with AI</div>
            </div>
          )}
          {messages.map((message, i) => (
            <div
              key={message.id || i}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
              style={{ 
                animationDelay: `${i * 0.1}s`,
                opacity: 0,
                animation: 'fadeIn 0.3s ease-in-out forwards'
              }}
            >
              <div className={`flex items-start space-x-2 max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${message.role === 'user' ? 'bg-indigo-600' : 'bg-purple-600'} transition-transform hover:scale-105 duration-200`}>
                  {message.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className={`rounded-xl px-4 py-3 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent transition-all duration-200 hover:shadow-lg ${message.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-800/90 text-gray-100 rounded-bl-none'}`}>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                    {message.content}
                  </pre>
                </div>
              </div>
            </div>
          ))}
          
          {/* Streaming response */}
          {(isLoading || streamContent) && (
            <div className="flex justify-start animate-fade-in">
              <div className="flex items-start space-x-2 max-w-[85%]">
                <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center">
                  🤖
                </div>
                <div className="bg-gray-800/90 text-gray-100 rounded-xl rounded-bl-none px-4 py-3 group hover:bg-gray-800/95 transition-all duration-200">
                  {streamContent || (
                    <div className="flex items-center h-5 gap-1">
                      <div className="w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-pulse"/>
                      <div className="w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-pulse [animation-delay:200ms]"/>
                      <div className="w-1.5 h-1.5 bg-purple-400/60 rounded-full animate-pulse [animation-delay:400ms]"/>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </fieldset>

      {/* Input Form in a fieldset */}
      <fieldset className="border-t border-gray-700/50 bg-gray-900/90 backdrop-blur-md p-6">
        <legend className="text-lg font-bold text-gray-100">Your Message</legend>
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="flex items-end gap-4">
            <div className="relative flex-1">
              <textarea
                value={input}
                onChange={handleInputChange}
                placeholder="Type your message..."
                rows={1}
                className="w-full rounded-2xl bg-gray-800/90 text-gray-100 border border-gray-700/50 px-6 py-4 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-gray-500 shadow-lg transition-all resize-none"
                style={{ minHeight: '60px', maxHeight: '200px' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim()) {
                      handleSubmit(e as any);
                    }
                  }
                }}
              />
              <div className="absolute right-4 bottom-3 text-gray-400 text-sm pointer-events-none">
                Press Enter ↵
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="bg-indigo-600 text-white px-6 py-4 rounded-xl hover:bg-indigo-500 shadow-lg transition-all disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed flex-shrink-0 h-[60px] flex items-center justify-center"
            >
              <span>Send</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-6 h-6 ml-2"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </form>
        </div>
      </fieldset>
    </div>
  )
}
